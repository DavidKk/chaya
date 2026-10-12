import { addTokenUsage } from '@/lib/game-agent/activity'
import { modelGameState } from '@/lib/game-agent/model-state'

import type { AgentHost, RuntimeCapabilityConfig, RuntimeMessage, RuntimeTool, TurnResult } from './types'

const RESULT_LIMIT = 8_000
const CONTEXT_LIMIT = 20_000
/** Latest tool-loop messages always sent, whatever their size. */
const KEEP_ROUNDS = 4
/** Consecutive replies with neither text nor a tool call before the turn stops. */
const EMPTY_REPLY_LIMIT = 3
const EMPTY_REPLY_NUDGE =
  'Your last reply was empty. Call the next game tool that moves the player goal forward now; if the goal is already complete, reply with a short summary instead.'
const FINISH_CHECK =
  'Before finishing, compare the player goal with the latest game state above and the tool results so far; targets the player excluded or did not ask for do not count. If a target the goal asks for is still left, call the next tool now. Otherwise reply to the player in the reply language with one or two short sentences about the result, without explaining your reasoning or this check.'

/** `chaya_live_interact` outcomes that leave the player free on the same map, so later calls of one reply still apply. */
const SETTLED_OUTCOMES = new Set(['done', 'gone', 'no_path', 'no_reaction', 'nothing_to_run', 'runs_by_itself'])
const SKIPPED_CALL = { skipped: true, reason: 'An earlier call in this reply changed the screen (choice, transfer, scene change or timeout). Look at its result and decide again.' }

function unsettled(result: unknown): boolean {
  const outcome = (result as { outcome?: unknown } | null)?.outcome
  return typeof outcome === 'string' && !SETTLED_OUTCOMES.has(outcome)
}

function resultText(value: unknown): string {
  const text = JSON.stringify(modelGameState(value)) ?? 'null'
  return text.length <= RESULT_LIMIT ? text : `${text.slice(0, RESULT_LIMIT)}…`
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
  input: { prompt: string; model?: string; history?: RuntimeMessage[]; modelPrompt?: string; storePrompt?: string; replyLanguage?: string },
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
  let lastToolName = ''
  let emptyReplies = 0
  /** Play turn acted since its last observation, so a final reply is checked against fresh state first. */
  let actedSinceCheck = false
  const interacted = new Set<number>()
  let usage
  host.events.emit({ type: 'phase', phase: 'observing', step: 0, maxSteps: config.maxSteps })
  const observer = config.capability === 'play' ? tools.find((tool) => tool.name === 'chaya_live_state' || tool.name === 'chaya_live_ui') : undefined
  const observe = async (callId: string) => {
    if (!observer) return
    host.events.emit({ type: 'tool.started', name: observer.name, callId, input: {}, startedAt: host.clock.now() })
    let result: unknown
    let ok = true
    try {
      result = await host.tools.call(observer.name, {}, signal)
    } catch (error) {
      ok = false
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    host.events.emit({ type: 'tool.completed', name: observer.name, callId, ok, output: result, durationMs: 0 })
    messages.push({ role: 'tool', tool_name: observer.name, content: resultText(result) })
    lastToolName = observer.name
    toolCalls += 1
    return result
  }
  // Give play-capable models a concrete live observation before asking for a
  // decision. This is a small deterministic bridge for models that otherwise
  // answer the movement request conversationally without emitting a tool call.
  await observe('observe-0')
  for (let step = 1; step <= config.maxSteps; step++) {
    if (signal.aborted) throw signal.reason
    host.events.emit({ type: 'phase', phase: 'thinking', step, maxSteps: config.maxSteps })
    host.events.emit({
      type: 'thought.updated',
      summary: { observation: step === 1 ? '正在读取当前状态与任务上下文。' : '正在根据最新工具结果重新判断。', plan: '选择下一项可验证的短操作。' },
    })
    const modelMessages = compactModelMessages(messages, requestIndex)
    host.events.emit({
      type: 'model.requested',
      model: input.model,
      messageCount: modelMessages.length,
      contextChars: modelMessages.reduce((total, message) => total + message.content.length, 0),
    })
    const modelStartedAt = host.clock.now()
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
      durationMs: host.clock.now() - modelStartedAt,
    })
    const calls = message.tool_calls?.length ? message.tool_calls : parseTextToolCalls(message.content, tools)
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
      if (config.capability === 'play' && (lastToolName === 'chaya_live_state' || lastToolName === 'chaya_live_ui')) {
        messages.push({
          role: 'user',
          content:
            '状态已经读取。如果还有玩家目标要的事要做，现在调用能推进目标的游戏工具（移动、互动、按键或卡片），完成后再回复；如果状态显示目标已经完成或没有符合目标的对象，直接用一两句话告诉玩家，不要为了调用而调用工具。',
        })
        lastToolName = ''
        continue
      }
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
      if (observer && actedSinceCheck && toolCalls < config.maxToolCalls) {
        actedSinceCheck = false
        await observe(`check-${step}`)
        lastToolName = ''
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
      await host.store.append([
        { role: 'user', content: storePrompt },
        { role: 'assistant', content: message.content.trim() },
      ])
      return { text: message.content.trim(), steps: step, toolCalls, reason: 'answered', ...(usage ? { usage } : {}) }
    }
    let screenChanged = false
    for (const [index, call] of calls.entries()) {
      if (signal.aborted) throw signal.reason
      if (screenChanged) {
        messages.push({ role: 'tool', tool_name: call.function.name, content: JSON.stringify(SKIPPED_CALL) })
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
      if (!tool) throw new Error(`工具不在 ${config.capability} 能力白名单中：${call.function.name}`)
      const callId = call.id || `${step}-${index}`
      toolCalls += 1
      lastToolName = tool.name
      if (tool.name !== 'chaya_live_state' && tool.name !== 'chaya_live_ui') actedSinceCheck = true
      if (tool.name === 'chaya_live_interact') interacted.add(Number(call.function.arguments.eventId))
      host.events.emit({ type: 'phase', phase: 'acting', step, maxSteps: config.maxSteps })
      const startedAt = host.clock.now()
      host.events.emit({ type: 'tool.started', name: tool.name, callId, input: call.function.arguments, startedAt })
      let result: unknown
      let ok = true
      try {
        result = await host.tools.call(tool.name, call.function.arguments, signal)
      } catch (error) {
        ok = false
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      host.events.emit({ type: 'tool.completed', name: tool.name, callId, ok, output: result, durationMs: host.clock.now() - startedAt })
      host.events.emit({ type: 'thought.updated', summary: { result: ok ? `${tool.name} 已完成。` : `${tool.name} 调用失败。`, next: '重新观察并判断下一步。' } })
      messages.push({ role: 'tool', tool_name: tool.name, content: resultText(result) })
      screenChanged = unsettled(result)
      host.events.emit({ type: 'phase', phase: 'verifying', step, maxSteps: config.maxSteps })
      if (config.capability === 'play') {
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
