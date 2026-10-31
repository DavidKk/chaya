import { PLUGIN_AGENT_NAME } from '@/constants/brand'
import { normalizeCompanionCharacter } from '@/lib/game-agent/companion'
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import type { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { FactView } from '@/lib/game-agent/companion/types'
import { parsePlayIntentResult, PLAY_INTENT_FORMAT, PLAY_INTENT_SYSTEM } from '@/lib/game-agent/intent'
import { playModelPrompt, playSystemPrompt } from '@/lib/game-agent/play-prompt'
import { parsePlayerCard, PLAYER_CARD_TOOL, PLAYER_CARD_TOOL_NAME, playerCardAnswer } from '@/lib/game-agent/player-card'
import { CLI_AUTO_MODEL, isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'
import { type RecallTurn, recallTurns, turnsFromMessages } from '@/lib/game-agent/recall'
import {
  type AgentTask,
  AgentTaskController,
  capabilityConfig,
  controlMemoryQueryFilter,
  formatControlMemoryContext,
  normalizeControlLifetime,
  parseAgentRoutine,
  resolveControlLifetime,
  runAgentTurn,
  type RuntimeMessage,
  type RuntimeTool,
  shouldContinueControlCycle,
} from '@/lib/game-agent/runtime'
import { agentSettingsFromSyncDocument, type AgentSyncSettings } from '@/lib/game-agent/settings-sync'
import { normalizeAgentTimeouts } from '@/lib/game-agent/timeouts'
import { mcpToolsFor } from '@/lib/integration/mcp-availability'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools } from '@/lib/integration/tools/live'
import { makeSaveTools } from '@/lib/integration/tools/saves'
import { makeSkillTools } from '@/lib/integration/tools/skills'
import type { ToolImpls } from '@/lib/integration/tools/types'
import type { AgentCommand } from '@/lib/runtime/agent-protocol'
import { COMPANION_REQUEST_TYPES } from '@/lib/runtime/companion-protocol'
import { isCompanionHostRequest } from '@/lib/runtime/companion-validation'
import type { AgentTaskMessage } from '@/lib/runtime/game-link-protocol'
import { IdempotentWriteCache } from '@/lib/runtime/recoverable-operation'
import { buildAskMessages } from '@/services/game-agent/prompt'

import { chayaFetch, createLogger, detectGameIdentity, gameRoomId } from '../../helpers'
import { installAgentControl } from '../control'
import { AGENT_MANUAL_INPUT_EVENT, readAgentGameState, runAgentCommand } from '../handlers'
import { readSharedAgentSync } from '../shared-settings'
import { tryRunInteractBatch } from './batch-jobs'
import { runChestRoutine } from './chest-routine'
import { assertControlStartLive, controlStartCancelled, createCompanionControlGate } from './companion-control-gate'
import { createBattleHost } from './companion-core/battle-host'
import { createBattleCapabilitiesRevision } from './companion-core/battle-support'
import { createCompanionFacts } from './companion-facts'
import { installCompanionMilestones } from './companion-facts-milestones'
import { createCompanionHost } from './companion-host'
import { collectCompanionMemory } from './companion-memory-collector'
import { completeRemoteOllama, createCompanionModel } from './companion-model'
import { createAgentRuntimeIdentity } from './identity'
import { createCompanionMemoryRuntime } from './memory-persistence'
import { createModelGate, MODEL_FAILURE_COOLDOWN_MS } from './model-gate'
import { battleRequiresAgentDecision, createGameWatchManager, formatWatchTrigger, type WatchPhase, type WatchTrigger } from './state-watch'
import { createGameAgentTaskStore } from './store'
import { runWithTaskControl } from './task-control'
import { createGameAgentTraceArchive } from './trace-archive'

const log = createLogger(PLUGIN_AGENT_NAME)
const SERVICE_RETRY_MIN_MS = 2_000
const SERVICE_RETRY_MAX_MS = 30_000
type Send = (message: AgentTaskMessage) => void

function parseConfig(value: unknown): AgentSyncSettings | null {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null
  const config = value as AgentSyncSettings
  if (!Array.isArray(config.profiles) || !config.profiles.length) return null
  const valid = (profile: AgentSyncSettings['profiles'][number]) =>
    !!profile?.id && (profile.provider === 'ollama' || isOpenApiProvider(profile.provider) ? !!profile.endpoint && !!profile.defaultModel : isCliProvider(profile.provider))
  if (!config.profiles.every(valid)) return null
  return { ...config, profiles: config.profiles.map((profile) => ({ ...profile, ...normalizeAgentTimeouts(profile) })) }
}

let runtimeConfig: AgentSyncSettings | null = null
function readConfig(): AgentSyncSettings | null {
  if (runtimeConfig) return runtimeConfig
  const shared = readSharedAgentSync()
  if (shared) return parseConfig(agentSettingsFromSyncDocument(shared))
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('chaya.agent.runtimeConfig.v1') : null
    if (stored) return parseConfig(JSON.parse(stored))
  } catch {}
  return null
}
function saveConfig(value: unknown): AgentSyncSettings {
  const config = parseConfig(value)
  if (!config) throw new Error('Agent 配置无效')
  runtimeConfig = config
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('chaya.agent.runtimeConfig.v1', JSON.stringify(config))
  } catch {}
  return config
}

function profileOf(config: AgentSyncSettings | null | undefined, profileId?: string) {
  if (!config) throw new Error('请先在 Chaya 网页连接一次游戏以同步 Agent 配置')
  return config.profiles.find((profile) => profile.id === profileId) ?? config.profiles.find((profile) => profile.id === config.defaultProfileId) ?? config.profiles[0]
}

function toolRuntime(taskId: string, recall: (args: Record<string, unknown>) => unknown): { definitions: RuntimeTool[]; implementations: ToolImpls } {
  let seq = 0
  const call: AgentCaller = async (target, method, params) => {
    const gameId = gameRoomId()
    if (target && target !== gameId) throw new Error(`游戏不在线：${target}`)
    return runAgentCommand({ id: `task-${taskId}-${++seq}`, method, params } as AgentCommand, { inputOwner: taskId })
  }
  return {
    definitions: [
      ...mcpToolsFor('plugin')
        .filter((tool) => tool.group === 'live' || tool.group === 'agent' || tool.group === 'edit')
        .map((tool) => ({ ...tool, groups: [tool.group] })),
    ],
    implementations: {
      ...makeLiveTools({ games: () => [{ gameId: gameRoomId() }], call }),
      ...makeSaveTools(call),
      ...makeEditTools(call),
      ...makeSkillTools(),
      chaya_agent_recall: async (args) => recall(args),
    },
  }
}

/** Stored turns of these tasks; the running task contributes its earlier play cycles. */
function taskTurns(tasks: AgentTask[]): RecallTurn[] {
  return tasks.flatMap((task) => turnsFromMessages(task.messages, { id: task.id, at: task.updatedAt, state: task.state }))
}

function recallContext(task: AgentTask, args: Record<string, unknown>, tasks: AgentTask[]) {
  return recallTurns(taskTurns(tasks.filter((candidate) => candidate.gameId === task.gameId && candidate.conversationId === task.conversationId)), args)
}

/** Read-only, facts-scope memory for one play cycle. Evidence only, never authorization. */
function playMemoryEvidence(facts: { current(): FactView }, memory: Pick<GameplayMemoryStore, 'queryDetailed'>) {
  try {
    const view = facts.current()
    const enemyIds = (view.current.enemies.value ?? []).map((enemy) => enemy.enemyId)
    const recalled = memory.queryDetailed(view.stamp.scope, controlMemoryQueryFilter(enemyIds))
    return formatControlMemoryContext(recalled.episodes, undefined, recalled.origin).text
  } catch {
    return formatControlMemoryContext([]).text
  }
}

function setInputOwner(taskId: string | null) {
  const host = window as Window & { __chayaAgentPlayTaskId?: string }
  if (taskId) host.__chayaAgentPlayTaskId = taskId
  else delete host.__chayaAgentPlayTaskId
}

function waitForNextPlayCycle(signal: AbortSignal, delay = 1_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = window.setTimeout(done, delay)
    function done() {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function createGameAgentRuntime(libraryGameId = gameRoomId()) {
  const identity = detectGameIdentity()
  const runtime = createAgentRuntimeIdentity(libraryGameId)
  const arbiter = createControlArbiter()
  const uninstallControl = installAgentControl(arbiter, runtime.identity.runtimeInstanceId)
  const traceArchive = createGameAgentTraceArchive(libraryGameId, runtime.identity.runtimeInstanceId)
  const controller = new AgentTaskController(createGameAgentTaskStore(identity?.gameRoot), {
    setInputOwner,
    traceArchive,
    runtimeIdentity: runtime.identity,
    producerEpoch: runtime.producerEpoch,
    executionHost: 'game_plugin',
  })
  const commands = new IdempotentWriteCache<AgentTask>()
  const ready = controller.restore()
  const facts = createCompanionFacts(runtime.identity, runtime.producerEpoch)
  const stopMilestones = installCompanionMilestones((event) => facts.onMilestone(event))
  const memory = createCompanionMemoryRuntime(libraryGameId, runtime.identity.runtimeInstanceId)
  const collector = collectCompanionMemory(facts, memory.store, (message) => log.warn(message))
  const gate = createCompanionControlGate()
  const stopLoadTracking = facts.subscribe((event) => {
    if (event.kind === 'load' && event.phase === 'begin') {
      gate.abortPending(controlStartCancelled('游戏读档，未开始的控制请求已取消'))
      for (const task of controller.list()) {
        if (!['running', 'waiting_user', 'waiting_service'].includes(task.state) || task.id === event.initiatorTaskId) continue
        controller.stop(task.id)
      }
    }
  })
  const manualTakeover = () => {
    companion.invalidateControl()
    for (const task of controller.list()) {
      if (task.capability === 'play' && ['running', 'waiting_user', 'waiting_service'].includes(task.state)) controller.stop(task.id)
    }
  }
  window.addEventListener(AGENT_MANUAL_INPUT_EVENT, manualTakeover)
  const modelGate = createModelGate()

  const completeFor = async (
    input: { id: string; gameId: string; profileId: string; model: string; task?: AgentTask },
    messages: RuntimeMessage[],
    definitions: RuntimeTool[],
    outerSignal: AbortSignal,
    format?: Record<string, unknown>
  ): Promise<RuntimeMessage> => {
    const config = readConfig()
    if (!config) throw new Error('请先在 Chaya 网页连接一次游戏以同步 Agent 配置')
    const profile = profileOf(config, input.profileId)
    const cli = isCliProvider(profile.provider)
    const openApi = isOpenApiProvider(profile.provider)
    const model = input.model || profile.defaultModel || (cli ? CLI_AUTO_MODEL : '')
    const remote = (window as Window & { CHAYA_MCP_GATEWAY?: unknown }).CHAYA_MCP_GATEWAY === true
    if (remote && (cli || openApi)) throw Object.assign(new Error('该接入类型需要 Chaya App 或本机服务，远程网关模式下不可用'), { nonRetryable: true })
    if (remote) {
      return completeRemoteOllama({
        endpoint: profile.endpoint,
        model,
        messages,
        tools: definitions,
        temperature: profile.temperature,
        keepAlive: profile.keepAlive,
        timeoutMs: profile.modelTimeoutMs,
        think: input.task?.thinking === true,
        ...(format ? { format } : {}),
        signal: outerSignal,
        priority: input.task ? 'control' : 'foreground',
        instanceId: runtime.identity.runtimeInstanceId,
      })
    }

    return modelGate.run(async () => {
      if (outerSignal.aborted) throw outerSignal.reason
      try {
        // The proxy responds only after generation completes, including for Ollama.
        const timeouts = { modelTimeoutMs: profile.modelTimeoutMs, modelRequestTimeoutMs: profile.modelTimeoutMs }
        const message = await requestModel(
          input.task,
          { profileId: profile.id, model, messages, tools: definitions, thinking: input.task?.thinking === true, ...(format ? { format } : {}) },
          timeouts,
          outerSignal
        )
        modelGate.reset()
        return message
      } catch (error) {
        if ((error as { modelFailed?: unknown })?.modelFailed) {
          modelGate.trip(error as Error)
          const source = input.task ? `${input.task.capability} 任务` : input.id.startsWith('classify:') ? '意图分类' : input.id
          log.warn(`Model request failed (${source} ), ${MODEL_FAILURE_COOLDOWN_MS / 1000}s cooldown: ${(error as Error).message}`)
        }
        throw error
      }
    })
  }

  const requestModel = async (
    task: AgentTask | undefined,
    payload: { profileId: string; model: string; messages: RuntimeMessage[]; tools: RuntimeTool[]; thinking?: boolean; format?: Record<string, unknown> },
    timeouts: { modelTimeoutMs: number; modelRequestTimeoutMs: number },
    outerSignal: AbortSignal
  ): Promise<RuntimeMessage> => {
    let lastError: unknown
    let retryDelay = SERVICE_RETRY_MIN_MS
    const deadline = Date.now() + timeouts.modelTimeoutMs
    while (!outerSignal.aborted && Date.now() < deadline) {
      try {
        const requestSignal = AbortSignal.any([outerSignal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
        const response = await chayaFetch('/api/game-agent/model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, think: payload.thinking === true }),
          signal: requestSignal,
        })
        const body = (await response.json().catch(() => null)) as { message?: RuntimeMessage; error?: { message?: string } } | null
        if (response.ok && body?.message) {
          const state = task ? controller.get(task.id)?.state : undefined
          if (state && ['completed', 'stopped', 'failed', 'interrupted'].includes(state)) throw new DOMException('任务已结束', 'AbortError')
          if (task && state === 'waiting_service') controller.setState(task.id, 'running')
          return body.message
        }
        const error = new Error(body?.error?.message || `Agent 模型代理 HTTP ${response.status}`)
        // 带错误体说明 Chaya 服务在线、是模型端失败（如 Ollama 未启动）；只有服务本身不可达才值得重试
        if (response.status < 500 || body?.error) throw Object.assign(error, { nonRetryable: true, modelFailed: response.status >= 500 })
        lastError = error
      } catch (error) {
        if (outerSignal.aborted) throw outerSignal.reason
        if (Date.now() >= deadline) throw new Error('模型生成超时，请调整模型总超时或使用更小的模型')
        if ((error as { nonRetryable?: unknown })?.nonRetryable) throw error
        lastError = error
      }
      if (task && controller.get(task.id)?.state === 'running') controller.setState(task.id, 'waiting_service')
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          outerSignal.removeEventListener('abort', abort)
          resolve()
        }
        const timer = window.setTimeout(finish, Math.max(0, Math.min(retryDelay, deadline - Date.now())))
        const abort = () => {
          window.clearTimeout(timer)
          outerSignal.removeEventListener('abort', abort)
          reject(outerSignal.reason)
        }
        outerSignal.addEventListener('abort', abort, { once: true })
      })
      retryDelay = Math.min(retryDelay * 2, SERVICE_RETRY_MAX_MS)
    }
    throw lastError instanceof Error ? lastError : new Error('无法连接 Chaya 本机服务')
  }

  /** 等玩家点选可能很久，不套游戏调用超时；任务停止时随 signal 结束 */
  const showPlayerCard = async (taskId: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const card = parsePlayerCard(args)
    if (!card) throw new Error('卡片参数无效：kind 为 confirm / choice / notice，text 必填，choice 需要 2–4 个选项')
    if (card.kind === 'notice') {
      controller.emit(taskId, 'card.shown', { card })
      return { shown: true }
    }
    return playerCardAnswer(card, await controller.waitForUser(taskId, card.text, signal, card))
  }

  const executeLegacy = async (task: AgentTask, signal: AbortSignal) => {
    if (task.routine) {
      if (task.routine.kind !== 'chest') {
        const tools = toolRuntime(task.id, () => ({ matches: [], count: 0 }))
        const profile = profileOf(readConfig()!, task.profileId)
        const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(profile.gameCallTimeoutMs)])
        const fixed =
          task.routine.kind === 'save'
            ? { name: 'chaya_live_save', args: { source: 'native', slot: task.routine.slot }, text: `已保存到游戏文件 ${task.routine.slot}。` }
            : task.routine.kind === 'load'
              ? { name: 'chaya_live_load_save', args: { source: 'native', slot: task.routine.slot }, text: `已读取游戏文件 ${task.routine.slot}。` }
              : { name: 'chaya_live_open_scene', args: { scene: `scene:${task.routine.scene}` }, text: '已打开对应游戏面板。' }
        const implementation = tools.implementations[fixed.name]
        if (!implementation) throw new Error(`工具不可用：${fixed.name}`)
        controller.emit(task.id, 'tool.started', { name: fixed.name, callId: 'fast-1', input: fixed.args, startedAt: Date.now() })
        const startedAt = Date.now()
        try {
          const output = await implementation(fixed.args, { signal: operationSignal })
          controller.emit(task.id, 'tool.completed', { name: fixed.name, callId: 'fast-1', ok: true, output, durationMs: Date.now() - startedAt })
          controller.emit(task.id, 'progress.updated', { summary: '本地快速操作 · 0 次模型调用', cycle: 0, steps: 1, toolCalls: 1 })
          controller.emit(task.id, 'assistant.completed', { text: fixed.text, reason: 'verified' })
        } catch (error) {
          controller.emit(task.id, 'tool.completed', {
            name: fixed.name,
            callId: 'fast-1',
            ok: false,
            output: { error: error instanceof Error ? error.message : String(error) },
            durationMs: Date.now() - startedAt,
          })
          throw error
        }
        return
      }
      let seq = 0
      const text = await runChestRoutine(task.routine, {
        signal,
        locale: task.locale,
        press: (key) => runAgentCommand({ id: `task-${task.id}-${++seq}`, method: 'input.press', params: { key } } as AgentCommand, { inputOwner: task.id }),
        report: (summary) => controller.emit(task.id, 'progress.updated', { summary }),
      })
      controller.emit(task.id, 'assistant.completed', { text, reason: 'answered' })
      return
    }
    const tools = toolRuntime(task.id, (args) => recallContext(task, args, controller.list()))
    const profile = profileOf(readConfig()!, task.profileId)
    const complete = (messages: RuntimeMessage[], definitions: RuntimeTool[], outerSignal: AbortSignal, format?: Record<string, unknown>) =>
      completeFor({ id: task.id, gameId: task.gameId, profileId: task.profileId, model: task.model, task }, messages, definitions, outerSignal, format)
    if ((task.capability === 'play' || task.capability === 'companion') && task.shape === 'batch') {
      const batch = await tryRunInteractBatch(
        task,
        (messages, _tools, outerSignal, format) => complete(messages, [], outerSignal, format),
        (type, data) => controller.emit(task.id, type, data),
        (question, outerSignal) => controller.waitForUser(task.id, question, outerSignal),
        signal
      )
      if (batch) {
        controller.emit(task.id, 'assistant.completed', { text: batch.text, reason: batch.reason })
        return
      }
    }
    const lifetime = normalizeControlLifetime(task.lifetime)
    const playSystem: RuntimeMessage = { role: 'system', content: playSystemPrompt(lifetime) }
    if (task.capability === 'play') controller.emit(task.id, 'prompt.recorded', { role: 'system', content: playSystem.content, source: 'runtime' })
    let cycle = 0
    const watch = createGameWatchManager()
    let steeringPrompt = ''
    let lastWatchPausePhase: WatchPhase | null = null
    const initialWatchState = readAgentGameState()
    const initialEvents = Array.isArray(initialWatchState.nearbyEvents) ? initialWatchState.nearbyEvents : []
    watch.setPlan({
      targetEventIds: initialEvents
        .filter((event) => event?.interactive && event.kind !== 'npc')
        .map((event) => Number(event.id))
        .filter((id) => Number.isInteger(id) && id > 0),
    })
    watch.reset(initialWatchState)
    for (;;) {
      if (signal.aborted) throw signal.reason
      const history =
        task.capability === 'play'
          ? [playSystem]
          : (buildAskMessages({
              prompt: task.goal,
              locale: task.locale || 'zh-CN',
              gameId: task.gameId,
              surface: task.capability === 'companion' ? 'companion' : undefined,
              companionCharacter: task.capability === 'companion' ? normalizeCompanionCharacter(task.companionCharacter) : undefined,
            }) as RuntimeMessage[])
      if (cycle === 0 && task.capability !== 'play') {
        for (const message of history.filter((item) => item.role === 'system'))
          controller.emit(task.id, 'prompt.recorded', { role: 'system', content: message.content, source: 'runtime' })
      }
      const result = await runAgentTurn(
        {
          model: { complete },
          tools: {
            list: () => [...tools.definitions, PLAYER_CARD_TOOL],
            call: async (name, args, callSignal) => {
              if (controller.get(task.id)?.state !== 'running') throw new DOMException('任务已停止', 'AbortError')
              if (name === PLAYER_CARD_TOOL_NAME) return showPlayerCard(task.id, args, callSignal)
              if (task.capability === 'play' && name === 'chaya_live_interact') {
                const eventId = Number(args.eventId)
                watch.setPlan({ targetEventIds: Number.isInteger(eventId) && eventId > 0 ? [eventId] : [] }, 'map_interaction')
              } else if (task.capability === 'play' && name === 'chaya_live_move_to') {
                const guard = args.guard && typeof args.guard === 'object' ? (args.guard as Record<string, unknown>) : {}
                const eventId = Number(guard.targetEventId)
                watch.setPlan({ targetEventIds: Number.isInteger(eventId) && eventId > 0 ? [eventId] : [] }, 'map_navigation')
              }
              const implementation = tools.implementations[name]
              if (!implementation) throw new Error(`工具不可用：${name}`)
              try {
                const operationSignal = AbortSignal.any([callSignal, AbortSignal.timeout(profile.gameCallTimeoutMs)])
                return await implementation(args, { signal: operationSignal })
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                if (!message.includes('ACTION_REQUIRES_CONFIRMATION')) throw error
                const reply = await controller.waitForUser(task.id, `当前操作需要玩家确认：${message}`, callSignal)
                return { ok: false, waitingResolved: true, playerReply: reply }
              }
            },
          },
          store: { append: (messages) => controller.appendMessages(task.id, messages) },
          events: {
            emit: (event) => {
              controller.emit(task.id, event.type, event)
              if (event.type === 'model.completed' && event.usage) controller.emit(task.id, 'usage.updated', event.usage)
              if (event.type === 'phase' && event.phase === 'thinking') controller.checkpoint(task.id)
            },
          },
          clock: { now: Date.now },
        },
        capabilityConfig(task.capability),
        task.capability === 'play'
          ? {
              model: `${profile.provider}/${task.model || profile.defaultModel}`,
              prompt: task.goal,
              modelPrompt: [playModelPrompt(task.goal, cycle, '', task.locale || 'zh-CN', lifetime), playMemoryEvidence(facts, memory.store), steeringPrompt]
                .filter(Boolean)
                .join('\n'),
              storePrompt: task.goal,
              history,
              replyLanguage: task.locale || 'zh-CN',
            }
          : {
              model: `${profile.provider}/${task.model || profile.defaultModel}`,
              prompt: task.goal,
              modelPrompt: String((history.at(-1) as RuntimeMessage | undefined)?.content || task.goal),
              storePrompt: task.goal,
              history: history.slice(0, -1),
            },
        signal
      )
      steeringPrompt = ''
      // Ask turns stay single-shot. Play tasks continue only by lifetime:
      // goal ends on verified/answered completion; until_stopped keeps the
      // existing watch / input guards. limit / no_progress never fake success.
      if (task.capability !== 'play') {
        controller.emit(task.id, 'assistant.completed', { text: result.text, reason: result.reason })
        if (result.reason === 'unsupported') throw new Error(result.text)
        return
      }
      if (result.reason === 'unsupported') throw new Error(result.text)
      if (!shouldContinueControlCycle({ lifetime, reason: result.reason })) {
        controller.emit(task.id, 'assistant.completed', { text: result.text, reason: result.reason })
        return
      }
      cycle += 1
      controller.emit(task.id, 'progress.updated', {
        summary: result.text.slice(0, 2_000),
        reason: result.reason,
        cycle,
        steps: result.steps,
        toolCalls: result.toolCalls,
        usage: result.usage,
      })
      if (result.reason === 'limit' || result.reason === 'no_progress') {
        // A bounded tool loop can end while a stable plan still has work left.
        // Continue without pretending the goal is already done.
        steeringPrompt =
          result.reason === 'limit'
            ? '[GAME_STEERING_EVENT]\n上一执行批次达到步数上限；场景没有新的相关变化，请继续原计划。\n[/GAME_STEERING_EVENT]'
            : '[GAME_STEERING_EVENT]\n上一执行批次没有可验证进展；不要把失败当成目标已完成，也不要重复已经完成的步骤。请重新观察后继续原授权目标。\n[/GAME_STEERING_EVENT]'
        await waitForNextPlayCycle(signal, isCliProvider(profile.provider) ? 5_000 : undefined)
        continue
      }
      // The just-finished tool loop already saw and handled its own changes.
      // Start the watch from the settled state so only later game changes can
      // wake the model; otherwise the Agent would immediately react to itself.
      watch.reset(readAgentGameState())
      const watchPhase = watch.getPhase()
      if (watchPhase === 'battle' || watchPhase === 'dialogue' || watchPhase === 'choice' || watchPhase === 'menu') {
        // These phases are intrinsically dynamic. The Agent's normal tool
        // loop owns observation and action; do not turn every battle HP/turn
        // update into a Watch-triggered model wakeup.
        steeringPrompt = ''
        if (lastWatchPausePhase !== watchPhase) {
          controller.emit(task.id, 'game.watch.paused', { phase: watchPhase, reason: 'agent_self_observes_dynamic_scene' })
          lastWatchPausePhase = watchPhase
        }
        if (watchPhase === 'battle') {
          let state = readAgentGameState()
          while (state.battle && !battleRequiresAgentDecision(state)) {
            await waitForNextPlayCycle(signal, 100)
            state = readAgentGameState()
          }
        } else {
          await waitForNextPlayCycle(signal, 200)
        }
        continue
      }
      lastWatchPausePhase = null
      controller.emit(task.id, 'game.watch.registered', { phase: watchPhase, cycle, pollMs: 200 })
      let trigger: WatchTrigger | null = null
      while (!trigger) {
        await waitForNextPlayCycle(signal, 200)
        trigger = watch.update(readAgentGameState())
      }
      controller.emit(task.id, 'game.watch.triggered', trigger)
      steeringPrompt = formatWatchTrigger(trigger)
    }
  }

  const execute = (task: AgentTask, signal: AbortSignal) => runWithTaskControl(arbiter, runtime.identity.runtimeInstanceId, task, signal, () => executeLegacy(task, signal))

  const completeCompanion = createCompanionModel(readConfig)
  const battleHost = createBattleHost({
    runtimeInstanceId: runtime.identity.runtimeInstanceId,
    arbiter,
    facts,
    controller,
    memory,
    complete: completeCompanion,
    getCapabilitiesRevision: createBattleCapabilitiesRevision(() => facts.current()),
  })
  const companion = createCompanionHost({
    facts,
    memory: memory.store,
    libraryGameId,
    complete: completeCompanion,
    getBattleContext: () => battleHost.chatContext(),
    beginBattleIntent: (sourceId, prompt) => battleHost.beginIntent(sourceId, prompt),
    onMemoryChanged: () => memory.synchronize(),
    stopExternalControl: () => controller.interruptAll(),
    startControl: async (input, remote, signal) => {
      assertControlStartLive(signal)
      return dispatch(
        {
          ...input,
          type: 'agent.task.start',
          deadlineAt: Date.now() + 60_000,
          taskId: crypto.randomUUID(),
          gameId: libraryGameId,
          capability: 'play',
          surface: 'companion',
        },
        remote,
        signal,
        input.action === 'battle' && input.shape === 'open' ? battleHost.execute : undefined
      ) as Promise<AgentTask>
    },
  })

  const dispatch = async (
    message: Exclude<AgentTaskMessage, { type: 'agent.task.result' }>,
    remote: boolean,
    signal?: AbortSignal,
    trustedExecute?: (task: AgentTask, signal: AbortSignal) => Promise<void>
  ): Promise<unknown> => {
    const tracked =
      message.type === 'agent.task.start' ? gate.trackStart(signal, message.deadlineAt) : message.type === 'agent.companion.control.start' ? gate.trackStart(signal) : null
    try {
      if (tracked) assertControlStartLive(tracked, message.type === 'agent.task.start' ? message.deadlineAt : undefined, gate.epoch)
      await ready
      if (tracked) assertControlStartLive(tracked, message.type === 'agent.task.start' ? message.deadlineAt : undefined, gate.epoch)
      if (COMPANION_REQUEST_TYPES.has(message.type)) {
        if (!isCompanionHostRequest(message)) throw Object.assign(new Error('Invalid companion request'), { code: 'REQUEST_CONFLICT' })
        return await companion.dispatch(message, remote, tracked?.signal ?? signal)
      }
      if (message.type === 'agent.transcript.request') {
        const { pluginStorageCall } = await import('../../helpers/storage/client')
        if (!identity) throw new Error('Game identity unavailable')
        if (message.transcript !== undefined) await pluginStorageCall('game.write', [identity.contentRoot, 'companionTranscript', message.transcript])
        return { transcript: await pluginStorageCall('game.read', [identity.contentRoot, 'companionTranscript']) }
      }
      if (message.type === 'agent.settings.request') {
        const { pluginStorageCall } = await import('../../helpers/storage/client')
        const sync =
          message.settings === undefined
            ? await pluginStorageCall<import('@/lib/game-agent/settings-sync').AgentSyncDocument>('settings.load')
            : (await pluginStorageCall<{ sync: import('@/lib/game-agent/settings-sync').AgentSyncDocument }>('settings.update', [message.settings, `game:${libraryGameId}`])).sync
        const { writeSharedAgentSync } = await import('../shared-settings')
        writeSharedAgentSync(sync)
        return { ok: true, settings: agentSettingsFromSyncDocument(sync), sync }
      }
      if (message.type === 'agent.config.put') return saveConfig(message.config)
      if (message.type === 'agent.task.classify') {
        const profile = profileOf(readConfig()!, message.profileId)
        const classifySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(profile.modelTimeoutMs)]) : AbortSignal.timeout(profile.modelTimeoutMs)
        const answer = await completeFor(
          { id: `classify:${message.requestId}`, gameId: message.gameId, profileId: message.profileId, model: message.model },
          [
            {
              role: 'system',
              content: `/no_think
${PLAY_INTENT_SYSTEM}`,
            },
            { role: 'user', content: JSON.stringify({ request: message.prompt }) },
          ],
          [],
          classifySignal,
          PLAY_INTENT_FORMAT as unknown as Record<string, unknown>
        )
        const intent = parsePlayIntentResult(answer.content)
        return {
          capability: intent.operate ? ('play' as const) : ('ask' as const),
          shape: intent.operate ? intent.shape : undefined,
          lifetime: intent.operate ? intent.lifetime : undefined,
          action: intent.action,
        }
      }
      if (message.type === 'agent.task.start') {
        const routine = message.routine === undefined ? undefined : parseAgentRoutine(message.routine)
        if (routine === null) throw new Error('托管目标无效')
        if (!routine && message.capability === 'companion') {
          throw Object.assign(new Error('旧自动陪聊工具循环已停用，请使用独立陪聊通道；历史任务仍可只读查看'), {
            code: 'CAPABILITY_UNSUPPORTED',
            retryable: false,
          })
        }
        if (remote && message.capability === 'play') {
          await gate.authorize(message.deadlineAt, tracked ?? undefined)
        }
        assertControlStartLive(tracked ?? undefined, message.deadlineAt, gate.epoch)
        const lifetime = resolveControlLifetime({
          lifetime: 'lifetime' in message ? message.lifetime : undefined,
          surface: message.surface,
        })
        return controller.start({
          ...message,
          routine,
          capability: routine ? 'play' : message.capability,
          ...(message.shape ? { shape: message.shape } : {}),
          lifetime,
          execute: trustedExecute ?? execute,
        })
      }
      if (message.type === 'agent.task.reply') {
        return commands.run({ requestId: message.requestId, deadlineAt: Date.now() + 60_000 }, async () => controller.reply(message.taskId, message.text))
      }
      if (message.type === 'agent.task.stop') {
        return commands.run({ requestId: message.requestId, deadlineAt: Date.now() + 60_000 }, async () => {
          companion.invalidateControl()
          gate.abortPending(controlStartCancelled('停止执行，未开始的控制请求已取消'))
          return controller.stop(message.taskId)
        })
      }
      if (message.type === 'agent.task.events') return controller.events(message.taskId, message.afterSeq)
      if (message.type === 'agent.task.clear') return { cleared: await controller.clear(message.taskId) }
      if (message.type === 'agent.task.recall') {
        const tasks = controller.list().filter((task) => !message.conversationId || task.conversationId === message.conversationId)
        return recallTurns(taskTurns(tasks), message)
      }
      if (message.type === 'agent.trace.list') return traceArchive.list()
      if (message.type === 'agent.trace.append') {
        if (message.task.gameId !== libraryGameId) throw new Error('Trace game identity does not match the connected game')
        await traceArchive.append(message.task, message.event)
        return { stored: true }
      }
      if (message.type === 'agent.trace.read') return traceArchive.read(message.taskId)
      if (message.type === 'agent.trace.export') return traceArchive.export(message.taskId)
      if (message.type === 'agent.trace.remove') return { removed: await traceArchive.remove(message.taskId) }
      return message.type === 'agent.task.status' && message.taskId ? controller.get(message.taskId) : controller.list()
    } finally {
      tracked?.release()
    }
  }

  const handle = (message: AgentTaskMessage, send: Send): boolean => {
    if (!message.type.startsWith('agent.') || message.type === 'agent.task.result') return false
    const requestId = message.requestId
    if (
      ![
        'agent.config.put',
        'agent.settings.request',
        'agent.transcript.request',
        'agent.task.classify',
        'agent.task.start',
        'agent.task.reply',
        'agent.task.stop',
        'agent.task.status',
        'agent.task.events',
        'agent.task.clear',
        'agent.task.recall',
        'agent.trace.list',
        'agent.trace.append',
        'agent.trace.read',
        'agent.trace.export',
        'agent.trace.remove',
      ].includes(message.type) &&
      !COMPANION_REQUEST_TYPES.has(message.type)
    ) {
      send({ type: 'agent.task.result', requestId, ok: false, error: `不支持的 Agent 消息：${message.type}` })
      return true
    }
    void dispatch(message, true).then(
      (data) => send({ type: 'agent.task.result', requestId, ok: true, data }),
      (error) =>
        send({ type: 'agent.task.result', requestId, ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code, retryable: error?.retryable })
    )
    return true
  }

  return {
    controller,
    handle,
    request: (message: Exclude<AgentTaskMessage, { type: 'agent.task.result' }>, signal?: AbortSignal) => dispatch(message, false, signal),
    cancelRemoteAuthorization: () => gate.cancelDialog(),
    dispose: () => {
      gate.dispose()
      stopLoadTracking()
      stopMilestones()
      window.removeEventListener(AGENT_MANUAL_INPUT_EVENT, manualTakeover)
      companion.dispose()
      facts.dispose()
      void collector
        .close()
        .then(() => memory.close())
        .catch((error) => log.warn(`Gameplay memory shutdown degraded: ${String(error)}`))
      controller.interruptAll()
      arbiter.revokeCurrent('user_stop')
      uninstallControl()
    },
  }
}
