import type { AgentHost, RuntimeCapabilityConfig, RuntimeMessage, TurnResult } from './types'

const RESULT_LIMIT = 16_000

function resultText(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length <= RESULT_LIMIT ? text : `${text.slice(0, RESULT_LIMIT)}…`
}

/** One host-neutral model/tool loop. Host adapters own transport, persistence and model credentials. */
export async function runAgentTurn(
  host: AgentHost,
  config: RuntimeCapabilityConfig,
  input: { prompt: string; history?: RuntimeMessage[] },
  signal: AbortSignal
): Promise<TurnResult> {
  const messages: RuntimeMessage[] = [...(input.history ?? []), { role: 'user', content: input.prompt }]
  const tools = (await host.tools.list()).filter(config.allowTool)
  let toolCalls = 0
  let previousAction = ''
  let repeatedAction = 0
  host.events.emit({ type: 'phase', phase: 'observing', step: 0, maxSteps: config.maxSteps })
  for (let step = 1; step <= config.maxSteps; step++) {
    if (signal.aborted) throw signal.reason
    host.events.emit({ type: 'phase', phase: 'thinking', step, maxSteps: config.maxSteps })
    const message = await host.model.complete(messages, tools, signal)
    messages.push(message)
    const calls = message.tool_calls ?? []
    if (!calls.length && message.content.trim()) {
      if (config.capability === 'play' && toolCalls === 0) {
        return { text: '当前模型没有发起任何游戏工具调用，无法执行帮玩任务。', steps: step, toolCalls, reason: 'unsupported' }
      }
      await host.store.append([
        { role: 'user', content: input.prompt },
        { role: 'assistant', content: message.content.trim() },
      ])
      return { text: message.content.trim(), steps: step, toolCalls, reason: 'answered' }
    }
    for (const [index, call] of calls.entries()) {
      if (signal.aborted) throw signal.reason
      if (toolCalls >= config.maxToolCalls) {
        const text = '操作未完成：已达到工具调用次数上限。'
        await host.store.append([
          { role: 'user', content: input.prompt },
          { role: 'assistant', content: text },
        ])
        return { text, steps: step, toolCalls, reason: 'limit' }
      }
      const tool = tools.find((candidate) => candidate.name === call.function.name)
      if (!tool) throw new Error(`工具不在 ${config.capability} 能力白名单中：${call.function.name}`)
      const callId = call.id || `${step}-${index}`
      toolCalls += 1
      host.events.emit({ type: 'phase', phase: 'acting', step, maxSteps: config.maxSteps })
      host.events.emit({ type: 'tool.started', name: tool.name, callId })
      let result: unknown
      let ok = true
      try {
        result = await host.tools.call(tool.name, call.function.arguments, signal)
      } catch (error) {
        ok = false
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      host.events.emit({ type: 'tool.completed', name: tool.name, callId, ok })
      messages.push({ role: 'tool', tool_name: tool.name, content: resultText(result) })
      host.events.emit({ type: 'phase', phase: 'verifying', step, maxSteps: config.maxSteps })
      if (config.capability === 'play') {
        const signature = JSON.stringify([tool.name, call.function.arguments, result])
        repeatedAction = signature === previousAction ? repeatedAction + 1 : 1
        previousAction = signature
        if (repeatedAction >= 3) {
          const text = '操作已停止：连续三次没有观察到新的进展。'
          await host.store.append([
            { role: 'user', content: input.prompt },
            { role: 'assistant', content: text },
          ])
          return { text, steps: step, toolCalls, reason: 'no_progress' }
        }
      }
    }
  }
  const text = '操作未完成：已达到工具调用步数上限。'
  await host.store.append([
    { role: 'user', content: input.prompt },
    { role: 'assistant', content: text },
  ])
  return { text, steps: config.maxSteps, toolCalls, reason: 'limit' }
}
