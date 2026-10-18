import { addTokenUsage } from '@/lib/game-agent/activity'
import { decisionEventForTool, gameplayEventsForTool } from '@/lib/game-agent/gameplay-activity'
import {
  compileInteractionGoal,
  interactionEventSignature,
  nearestInteractionTarget,
  remainingInteractionTargets,
  validateInteractionTarget,
} from '@/lib/game-agent/interaction-target'
import { modelGameState, selectGameState } from '@/lib/game-agent/model-state'

import type { AgentCapability, AgentHost, RuntimeCapabilityConfig, RuntimeMessage, RuntimeTool, TurnResult } from './types'

/** Companion and play both drive the live game; ask does not. */
function usesLiveActionGates(capability: AgentCapability) {
  return capability === 'play' || capability === 'companion'
}

const RESULT_LIMIT = 8_000
const CONTEXT_LIMIT = 20_000
/** Latest tool-loop messages always sent, whatever their size. */
const KEEP_ROUNDS = 4
/** Consecutive replies with neither text nor a tool call before the turn stops. */
const EMPTY_REPLY_LIMIT = 3
const EMPTY_REPLY_NUDGE =
  'Your last reply was empty. Call the next game tool that moves the player goal forward now; if the goal is already complete, reply with a short summary instead.'
const FINISH_CHECK =
  'Before finishing, compare the player goal with the latest game state above and the tool results so far; targets the player excluded or did not ask for do not count. Opening a menu or scene is not enough when the goal is to equip, use, save, load, or change something—verify party.equipment / inventory / the save slot actually changed. If a target the goal asks for is still left, call the next tool now. Otherwise reply to the player in the reply language with one or two short sentences about the result, without explaining your reasoning or this check.'
const PREMATURE_FINISH_LIMIT = 3
const OBSERVE_ONLY_TOOLS = new Set(['chaya_live_state', 'chaya_live_ui', 'chaya_live_open_scene'])
const MENU_SCENES = new Set(['Scene_Equip', 'Scene_Item', 'Scene_Skill', 'Scene_Status', 'Scene_Save', 'Scene_Load', 'Scene_Menu', 'Scene_Options'])
const MENU_NAV_NUDGE =
  'The menu or equip/item scene is open, but the player goal is not verified yet. Use chaya_live_press to navigate windows (ok/up/down/cancel), then re-read state and confirm party.equipment or inventory changed before replying. Do not ask the player what to do next.'
const EQUIP_UNCHANGED_NUDGE =
  'party.equipment has not changed since this turn started. Opening the equip scene and pressing ok/cancel is not enough—select a bag weapon and confirm until an equipment slot shows a real item name (not empty). Do not tell the player it succeeded. Call the next chaya_live_press / chaya_live_state tools now.'

/** `chaya_live_interact` outcomes that leave the player free on the same map, so later calls of one reply still apply. */
const SETTLED_OUTCOMES = new Set(['done', 'gone', 'no_path', 'no_reaction', 'nothing_to_run', 'runs_by_itself'])
const SKIPPED_CALL = { skipped: true, reason: 'An earlier call in this reply changed the screen (choice, transfer, scene change or timeout). Look at its result and decide again.' }
const STALE_INTERACTION_CALL = { skipped: true, reason: 'The previous interaction may have changed nearby events. Use the fresh game state and choose the next target again.' }

function unsettled(result: unknown): boolean {
  const outcome = (result as { outcome?: unknown } | null)?.outcome
  return typeof outcome === 'string' && !SETTLED_OUTCOMES.has(outcome)
}

function resultText(value: unknown): string {
  const text = JSON.stringify(modelGameState(value)) ?? 'null'
  return text.length <= RESULT_LIMIT ? text : `${text.slice(0, RESULT_LIMIT)}…`
}

function observationState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  if ('state' in value && (value as { state?: unknown }).state && typeof (value as { state?: unknown }).state === 'object') {
    return (value as { state: Record<string, unknown> }).state
  }
  return value as Record<string, unknown>
}

function simpleMapObservation(value: unknown): boolean {
  const state = observationState(value)
  if (!state) return false
  const message = state.message as { busy?: unknown; choices?: unknown } | null | undefined
  return state.scene === 'Scene_Map' && !state.battle && !message?.busy && !(Array.isArray(message?.choices) && message.choices.length)
}

function menuSceneOpen(value: unknown): boolean {
  const scene = observationState(value)?.scene
  return typeof scene === 'string' && MENU_SCENES.has(scene)
}

/** Compact party equipment fingerprint used to reject false "equipped" replies. */
function partyEquipmentSignature(value: unknown): string | null {
  const party = observationState(value)?.party
  if (!Array.isArray(party)) return null
  return party
    .map((member, memberIndex) => {
      if (!member || typeof member !== 'object') return `${memberIndex}:`
      const equipment = (member as { equipment?: unknown }).equipment
      if (!Array.isArray(equipment)) return `${memberIndex}:`
      return `${memberIndex}:${equipment
        .map((item, index) => {
          if (item && typeof item === 'object') {
            const slot = (item as { slot?: unknown }).slot
            const name = (item as { name?: unknown }).name
            const id = (item as { id?: unknown }).id
            const label = typeof name === 'string' && name ? name : id != null ? String(id) : 'empty'
            return `${typeof slot === 'number' ? slot : index}:${label}`
          }
          return `${index}:${item == null || item === '' ? 'empty' : String(item)}`
        })
        .join(',')}`
    })
    .join('|')
}

/**
 * Messages are kept or dropped whole, never cut. The system prompt and the
 * current request always stay; within a long tool loop the oldest rounds go
 * first. Earlier conversation turns are never part of the input (see recall).
 */
function compactModelMessages(messages: RuntimeMessage[], requestIndex: number): RuntimeMessage[] {
  const head = messages.slice(0, requestIndex + 1)
  const rounds = messages.slice(requestIndex + 1)
  const size = (list: RuntimeMessage[]) => list.reduce((sum, message) => sum + message.content.length, 0)
  let total = size(head) + size(rounds)
  let start = 0
  while (total > CONTEXT_LIMIT && rounds.length - start > KEEP_ROUNDS) total -= rounds[start++].content.length
  return [...head, ...rounds.slice(start)]
}

function toolNamePattern(name: string) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Some local models print a tool call as text instead of using Ollama's
 * `tool_calls` field. Keep that text out of the player conversation and turn
 * the two common forms into the same runtime call shape.
 */
function parseTextToolCalls(content: string, tools: RuntimeTool[]) {
  const calls: Array<{ id?: string; function: { name: string; arguments: Record<string, unknown> } }> = []
  const available = tools.map((tool) => tool.name).filter(Boolean)
  if (!available.length) return calls

  const parseArguments = (raw: string | undefined): Record<string, unknown> => {
    if (!raw?.trim()) return {}
    const value = raw.trim()
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      /* Accept the compact `{x:15,y:11}` form used by smaller local models. */
    }
    const args: Record<string, unknown> = {}
    const pair = /([A-Za-z_][\w-]*)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false|null)/g
    for (const match of value.matchAll(pair)) {
      const key = match[1]
      const token = match[2]
      args[key] = token === 'true' ? true : token === 'false' ? false : token === 'null' ? null : /^['"]/.test(token) ? token.slice(1, -1) : Number(token)
    }
    return args
  }

  const envelope = content.trim().match(/^\{[\s\S]*\}$/)
  if (envelope) {
    try {
      const parsed = JSON.parse(envelope[0]) as { action?: unknown; args?: unknown; input?: unknown; parameters?: unknown }
      if (typeof parsed.action === 'string' && available.includes(parsed.action)) {
        const value = parsed.args ?? parsed.input ?? parsed.parameters
        calls.push({ function: { name: parsed.action, arguments: value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {} } })
        return calls
      }
    } catch {
      /* Fall through to the compact tool syntax. */
    }
  }

  for (const name of available) {
    const match = content.match(new RegExp(`(?:^|[^\\w])${toolNamePattern(name)}\\s*:?\\s*(?:\\((\\{[\\s\\S]*?\\})\\)|(\\{[\\s\\S]*?\\}))?`, 'i'))
    if (!match) continue
    const rawArgs = match[1] || match[2]
    calls.push({ function: { name, arguments: parseArguments(rawArgs) } })
    break
  }
  return calls
}

/** One host-neutral model/tool loop. Host adapters own transport, persistence and model credentials. */
export async function runAgentTurn(
  host: AgentHost,
  config: RuntimeCapabilityConfig,
  input: {
    prompt: string
    model?: string
    history?: RuntimeMessage[]
    modelPrompt?: string
    storePrompt?: string
    replyLanguage?: string
    /** Trace-replay controls; omitted by production callers. */
    debug?: { disableCompaction?: boolean; disableSnapshotReplacement?: boolean; preserveRequestedInteractions?: boolean }
  },
  signal: AbortSignal
): Promise<TurnResult> {
  const messages: RuntimeMessage[] = [...(input.history ?? []), { role: 'user', content: input.modelPrompt || input.prompt }]
  const requestIndex = messages.length - 1
  const storePrompt = input.storePrompt || input.prompt
  const tools = (await host.tools.list()).filter(config.allowTool)
  let toolCalls = 0
  let previousAction = ''
  let repeatedAction = 0
  let playTextRetry = false
  let emptyReplies = 0
  let prematureFinishReplies = 0
  let menuNavNudges = 0
  let equipUnchangedNudges = 0
  /** Play turn acted since its last observation, so a final reply is checked against fresh state first. */
  let actedSinceCheck = false
  /** True once the turn used a non-observe tool that can change menus or the world. */
  let menuNavTaken = false
  let menuOpened = false
  const interacted = new Set<number>()
  const interactedSignatures = new Map<number, string>()
  const interactionGoal = compileInteractionGoal(input.prompt)
  let equipGoal = false
  let latestObservedState: unknown
  let baselineEquipment: string | null = null
  let latestEquipment: string | null = null
  let usage
  host.events.emit({ type: 'phase', phase: 'observing', step: 0, maxSteps: config.maxSteps })
  const liveGates = usesLiveActionGates(config.capability)
  const observer = liveGates ? tools.find((tool) => tool.name === 'chaya_live_state' || tool.name === 'chaya_live_ui') : undefined
  const rememberObservation = (result: unknown) => {
    if (observationState(result)?.scene === 'Scene_Equip') equipGoal = true
    latestObservedState = result
    const equipment = partyEquipmentSignature(result)
    if (equipment != null) {
      latestEquipment = equipment
      if (baselineEquipment == null) baselineEquipment = equipment
    }
    for (const [eventId, signature] of interactedSignatures) {
      const current = interactionEventSignature(result, eventId)
      if (current && current !== signature) {
        interacted.delete(eventId)
        interactedSignatures.delete(eventId)
        host.events.emit({ type: 'thought.updated', summary: { observation: `事件 ${eventId} 的语义已变化，将按新目标重新评估。` } })
      }
    }
  }
  const observe = async (callId: string) => {
    if (!observer) return
    const stepId = callId
    const startedAt = host.clock.now()
    host.events.emit({ type: 'tool.started', name: observer.name, callId, stepId, actionId: callId, input: {}, startedAt })
    let result: unknown
    let ok = true
    try {
      result = await host.tools.call(observer.name, { sections: equipGoal ? ['equipment', 'ui'] : ['map', 'ui', 'battle'] }, signal)
      rememberObservation(result)
    } catch (error) {
      ok = false
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const durationMs = host.clock.now() - startedAt
    host.events.emit({ type: 'tool.completed', name: observer.name, callId, stepId, actionId: callId, ok, output: result, durationMs })
    for (const event of gameplayEventsForTool({ name: observer.name, input: {}, output: result, ok, stepId, actionId: callId, durationMs })) host.events.emit(event)
    // Ordinary map observations are full snapshots. Once a newer snapshot is
    // available, retaining older copies only repeats event and inventory data.
    // Keep richer history for battles, dialogue and choices where state changes
    // across several steps are useful to the model.
    if (ok && simpleMapObservation(result) && !input.debug?.disableSnapshotReplacement) {
      for (const message of messages) {
        if (message.role === 'tool' && message.tool_name === observer.name) message.content = '{"superseded":true}'
      }
    }
    messages.push({ role: 'tool', tool_name: observer.name, content: resultText(selectGameState(result, equipGoal ? ['equipment', 'ui'] : ['map', 'ui', 'battle'])) })
    toolCalls += 1
    return result
  }
  if (config.capability === 'play' && interactionGoal.multi) {
    messages.push({
      role: 'user',
      content: `[TASK_CONTRACT] mode=interact_all_visible; excluded=${interactionGoal.excludedKinds.join(',') || 'none'}; refresh_after_each=true; completion=runtime_verified [/TASK_CONTRACT]`,
    })
  }
  for (let step = 1; step <= config.maxSteps; step++) {
    if (signal.aborted) throw signal.reason
    host.events.emit({ type: 'phase', phase: 'thinking', step, maxSteps: config.maxSteps })
    host.events.emit({
      type: 'thought.updated',
      summary: { observation: step === 1 ? '正在读取当前状态与任务上下文。' : '正在根据最新工具结果重新判断。', plan: '选择下一项可验证的短操作。' },
    })
    const contextStartedAt = host.clock.now()
    const modelMessages = input.debug?.disableCompaction ? messages : compactModelMessages(messages, requestIndex)
    const modelStartedAt = host.clock.now()
    host.events.emit({
      type: 'model.requested',
      startedAt: modelStartedAt,
      contextDurationMs: modelStartedAt - contextStartedAt,
      model: input.model,
      messageCount: modelMessages.length,
      contextChars: modelMessages.reduce((total, message) => total + message.content.length, 0),
    })
    const message = await host.model.complete(modelMessages, tools, signal)
    usage = addTokenUsage(usage, message.usage)
    const visible = {
      role: message.role,
      content: message.content,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      ...(message.usage ? { usage: message.usage } : {}),
    }
    host.events.emit({
      type: 'model.completed',
      model: input.model,
      text: visible.content,
      ...(message.thought ? { thought: message.thought } : {}),
      usage: message.usage,
      ...(message.timing ? { timing: message.timing } : {}),
      durationMs: host.clock.now() - modelStartedAt,
    })
    let calls = message.tool_calls?.length ? message.tool_calls : parseTextToolCalls(message.content, tools)
    if (config.capability === 'play' && !input.debug?.preserveRequestedInteractions) {
      calls = calls.map((call) => {
        if (call.function.name !== 'chaya_live_interact') return call
        const eventId = nearestInteractionTarget(latestObservedState, input.prompt, interacted)
        if (eventId == null || Number(call.function.arguments.eventId) === eventId) return call
        host.events.emit({ type: 'thought.updated', summary: { plan: `按最新可见路径改为最近的可交互目标 ${eventId}。` } })
        return { ...call, function: { ...call.function, arguments: { ...call.function.arguments, eventId } } }
      })
    }
    if (!calls.length && !message.content.trim()) {
      if (++emptyReplies >= EMPTY_REPLY_LIMIT) {
        const text = '操作已停止：模型连续返回空回复。'
        await host.store.append([
          { role: 'user', content: storePrompt },
          { role: 'assistant', content: text },
        ])
        return { text, steps: step, toolCalls, reason: 'no_progress', ...(usage ? { usage } : {}) }
      }
      messages.push({ role: 'user', content: EMPTY_REPLY_NUDGE })
      continue
    }
    emptyReplies = 0
    // A call printed as text is kept as a real tool call so the following tool result has a matching request.
    messages.push(calls.length && !message.tool_calls?.length ? { ...visible, content: '', tool_calls: calls } : visible)
    if (!calls.length) {
      const remaining = config.capability === 'play' ? remainingInteractionTargets(latestObservedState, input.prompt, interacted) : []
      if (interactionGoal.multi && remaining.length) {
        prematureFinishReplies++
        if (prematureFinishReplies >= PREMATURE_FINISH_LIMIT) {
          const text = `操作未完成：模型提前结束，仍有 ${remaining.length} 个符合条件的目标。`
          await host.store.append([
            { role: 'user', content: storePrompt },
            { role: 'assistant', content: text },
          ])
          return { text, steps: step, toolCalls, reason: 'no_progress', ...(usage ? { usage } : {}) }
        }
        messages.push({
          role: 'user',
          content: `[TASK_GATE] canFinish=false; remainingTargets=${JSON.stringify(remaining)}. Text completion was rejected. Call the next game tool. [/TASK_GATE]`,
        })
        continue
      }
      // Autopilot `play` must not answer with bare text; companion may clarify before acting.
      if (config.capability === 'play' && toolCalls === 0) {
        if (!playTextRetry) {
          playTextRetry = true
          messages.push({
            role: 'user',
            content: '你刚才只返回了文字，没有执行玩家目标。请不要解释或聊天；现在必须先调用一个合适的游戏工具（例如先读取当前状态），然后再继续完成玩家目标。',
          })
          continue
        }
        return { text: '当前模型没有发起任何游戏工具调用，无法执行托管任务。', steps: step, toolCalls, reason: 'unsupported', ...(usage ? { usage } : {}) }
      }
      if (
        liveGates &&
        (config.capability === 'play' || actedSinceCheck || menuOpened) &&
        menuSceneOpen(latestObservedState) &&
        !menuNavTaken &&
        menuNavNudges < PREMATURE_FINISH_LIMIT
      ) {
        menuNavNudges++
        messages.push({ role: 'user', content: MENU_NAV_NUDGE })
        continue
      }
      if (observer && actedSinceCheck && toolCalls < config.maxToolCalls) {
        actedSinceCheck = false
        await observe(`check-${step}`)
        messages.push({
          role: 'user',
          content: [
            FINISH_CHECK,
            interacted.size ? `Events already interacted with in this turn: ${JSON.stringify([...interacted])}.` : '',
            input.replyLanguage ? `Reply language: ${input.replyLanguage}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        })
        continue
      }
      // Equip goals: reject "already equipped" when party.equipment still matches the turn baseline.
      if (
        liveGates &&
        equipGoal &&
        menuNavTaken &&
        baselineEquipment != null &&
        latestEquipment != null &&
        latestEquipment === baselineEquipment &&
        equipUnchangedNudges < PREMATURE_FINISH_LIMIT
      ) {
        equipUnchangedNudges++
        if (equipUnchangedNudges >= PREMATURE_FINISH_LIMIT) {
          const text = '操作未完成：装备栏没有变化，无法确认武器已装备。'
          await host.store.append([
            { role: 'user', content: storePrompt },
            { role: 'assistant', content: text },
          ])
          return { text, steps: step, toolCalls, reason: 'no_progress', ...(usage ? { usage } : {}) }
        }
        messages.push({
          role: 'user',
          content: `${EQUIP_UNCHANGED_NUDGE}\nBaseline equipment: ${baselineEquipment}\nCurrent equipment: ${latestEquipment}`,
        })
        continue
      }
      await host.store.append([
        { role: 'user', content: storePrompt },
        { role: 'assistant', content: message.content.trim() },
      ])
      return { text: message.content.trim(), steps: step, toolCalls, reason: 'answered', ...(usage ? { usage } : {}) }
    }
    let screenChanged = false
    let interactionChangedTargets = false
    for (const [index, call] of calls.entries()) {
      if (signal.aborted) throw signal.reason
      if (screenChanged) {
        messages.push({ role: 'tool', tool_name: call.function.name, content: JSON.stringify(interactionChangedTargets ? STALE_INTERACTION_CALL : SKIPPED_CALL) })
        continue
      }
      if (toolCalls >= config.maxToolCalls) {
        const text = '操作未完成：已达到工具调用次数上限。'
        await host.store.append([
          { role: 'user', content: storePrompt },
          { role: 'assistant', content: text },
        ])
        return { text, steps: step, toolCalls, reason: 'limit', ...(usage ? { usage } : {}) }
      }
      const tool = tools.find((candidate) => candidate.name === call.function.name)
      if (!tool) throw new Error(`Tool is not in capability allowlist for ${config.capability}: ${call.function.name}`)
      if (tool.name === 'chaya_live_open_scene' && call.function.arguments.scene === 'scene:equip') equipGoal = true
      const callId = call.id || `${step}-${index}`
      const stepId = `step-${step}`
      toolCalls += 1
      if (tool.name.startsWith('chaya_live_') && !OBSERVE_ONLY_TOOLS.has(tool.name)) {
        actedSinceCheck = true
        if (tool.name === 'chaya_live_press') menuNavTaken = true
      }
      host.events.emit({ type: 'phase', phase: 'acting', step, maxSteps: config.maxSteps })
      const startedAt = host.clock.now()
      const decision = decisionEventForTool(tool.name, call.function.arguments, stepId, callId)
      if (decision) host.events.emit(decision)
      host.events.emit({ type: 'tool.started', name: tool.name, callId, stepId, actionId: callId, input: call.function.arguments, startedAt })
      let result: unknown
      let ok = true
      const eventId = Number(call.function.arguments.eventId)
      const targetDecision =
        tool.name === 'chaya_live_interact' && interactionGoal.multi
          ? validateInteractionTarget(latestObservedState, input.prompt, eventId, interacted)
          : { accepted: true as const }
      if (!targetDecision.accepted) {
        ok = false
        result = { ok: false, policyRejected: true, ...targetDecision }
        actedSinceCheck = false
        host.events.emit({ type: 'thought.updated', summary: { result: '候选操作不符合当前任务约束，未发送到游戏。', next: '根据最新任务状态重新选择目标。' } })
      } else {
        if (tool.name === 'chaya_live_interact') {
          interacted.add(eventId)
          const signature = interactionEventSignature(latestObservedState, eventId)
          if (signature) interactedSignatures.set(eventId, signature)
        }
        prematureFinishReplies = 0
        try {
          result = await host.tools.call(tool.name, call.function.arguments, signal)
        } catch (error) {
          ok = false
          result = { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      const durationMs = host.clock.now() - startedAt
      if (ok && (tool.name === 'chaya_live_state' || tool.name === 'chaya_live_ui')) {
        rememberObservation(result)
        // A model-requested read already verifies the preceding input.
        if (tool.name === 'chaya_live_state' && (!equipGoal || partyEquipmentSignature(result) != null)) actedSinceCheck = false
      }
      host.events.emit({ type: 'tool.completed', name: tool.name, callId, stepId, actionId: callId, ok, output: result, durationMs })
      for (const event of gameplayEventsForTool({ name: tool.name, input: call.function.arguments, output: result, ok, stepId, actionId: callId, durationMs }))
        host.events.emit(event)
      host.events.emit({ type: 'thought.updated', summary: { result: ok ? '游戏操作已完成。' : '游戏操作失败。', next: '重新观察并判断下一步。' } })
      messages.push({ role: 'tool', tool_name: tool.name, content: resultText(result) })
      screenChanged = unsettled(result)
      if (ok && config.capability === 'play' && observer && tool.name === 'chaya_live_interact') {
        interactionChangedTargets = true
        screenChanged = true
        actedSinceCheck = false
        await observe(`refresh-${step}-${index}`)
        messages.push({
          role: 'user',
          content: [
            FINISH_CHECK,
            interacted.size ? `Events already interacted with in this turn: ${JSON.stringify([...interacted])}.` : '',
            input.replyLanguage ? `Reply language: ${input.replyLanguage}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        })
      }
      // open_scene only returns {done,id}; pull a fresh menu snapshot so the model
      // sees slot/item options before the next press.
      if (ok && liveGates && observer && tool.name === 'chaya_live_open_scene') {
        menuOpened = true
        actedSinceCheck = false
        await observe(`menu-${step}-${index}`)
        messages.push({
          role: 'user',
          content:
            '菜单已打开。请根据最新 windows（尤其 active 窗口的 options / index）继续：装备目标先选武器槽再选背包武器，并用 party.equipment 验证；不要在未看到 options 时盲目 ok/cancel。',
        })
      }
      host.events.emit({ type: 'phase', phase: 'verifying', step, maxSteps: config.maxSteps })
      if (liveGates) {
        const signature = JSON.stringify([tool.name, call.function.arguments, result])
        repeatedAction = signature === previousAction ? repeatedAction + 1 : 1
        previousAction = signature
        if (repeatedAction >= 3) {
          const text = '操作已停止：连续三次没有观察到新的进展。'
          await host.store.append([
            { role: 'user', content: storePrompt },
            { role: 'assistant', content: text },
          ])
          return { text, steps: step, toolCalls, reason: 'no_progress', ...(usage ? { usage } : {}) }
        }
      }
    }
  }
  const text = '操作未完成：已达到工具调用步数上限。'
  await host.store.append([
    { role: 'user', content: storePrompt },
    { role: 'assistant', content: text },
  ])
  return { text, steps: config.maxSteps, toolCalls, reason: 'limit', ...(usage ? { usage } : {}) }
}
