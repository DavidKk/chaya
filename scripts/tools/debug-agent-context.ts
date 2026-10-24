import { type AgentHost, capabilityConfig, runAgentTurn, type RuntimeMessage, type RuntimeTool } from '@/lib/game-agent/runtime'
import { DEFAULT_OLLAMA_HOST, streamOllamaChat } from '@/services/game-agent/ollama-client'
import type { GameAgentMessage, OllamaTool } from '@/services/game-agent/types'

const model = process.env.CHAYA_AGENT_MODEL || 'gemma4:e4b'
const endpoint = process.env.CHAYA_OLLAMA_HOST || DEFAULT_OLLAMA_HOST
const useRealModel = process.env.CHAYA_CONTEXT_REAL === '1'

const tools: RuntimeTool[] = [
  { name: 'chaya_live_state', description: 'Read the current visible game state.', groups: ['live'], inputSchema: { type: 'object', properties: {} } },
  { name: 'chaya_live_press', description: 'Press one game key.', groups: ['live'], inputSchema: { type: 'object', properties: { key: { type: 'string' } } } },
]

function state(index: number) {
  return {
    scene: 'Scene_Map',
    player: { x: index, y: 2 },
    nearbyEvents: [{ id: index + 1, interactive: true, kind: 'pickup', label: `target-${index}` }],
    screenText: `ordinary-map-${index}-${'x'.repeat(1_200)}`,
  }
}

function toOllamaTools(runtimeTools: RuntimeTool[]): OllamaTool[] {
  return runtimeTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  }))
}

function realModel() {
  return async (messages: RuntimeMessage[], runtimeTools: RuntimeTool[], signal: AbortSignal): Promise<RuntimeMessage> => {
    const response = await streamOllamaChat(
      {
        endpoint,
        model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.tool_name ? { tool_name: message.tool_name } : {}),
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        })) as GameAgentMessage[],
        tools: toOllamaTools(runtimeTools),
        think: false,
        timeoutMs: 120_000,
        signal,
      },
      () => undefined
    )
    return response as RuntimeMessage
  }
}

function mockModel() {
  const replies: RuntimeMessage[] = [
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_state', arguments: {} } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_press', arguments: { key: 'ok' } } }] },
    { role: 'assistant', content: '完成。' },
  ]
  return async (messages: RuntimeMessage[]) => {
    const reply = replies.shift() || { role: 'assistant' as const, content: '完成。' }
    const input = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4)
    const output = Math.ceil(reply.content.length / 4)
    return { ...reply, usage: { input, output, total: input + output } }
  }
}

async function main() {
  let snapshot = 0
  const events: Array<Record<string, unknown>> = []
  const host: AgentHost = {
    model: { complete: useRealModel ? realModel() : mockModel() },
    tools: {
      list: () => tools,
      call: async (name) => {
        if (name === 'chaya_live_state') return state(snapshot++)
        return { ok: true, outcome: 'done' }
      },
    },
    store: { append: () => undefined },
    events: { emit: (event) => events.push(event as unknown as Record<string, unknown>) },
    clock: { now: () => Date.now() },
  }
  const startedAt = Date.now()
  const result = await runAgentTurn(host, capabilityConfig('play'), { prompt: '检查并处理附近可交互目标' }, new AbortController().signal)
  const requests = events.filter((event) => event.type === 'model.requested')
  const completions = events.filter((event) => event.type === 'model.completed')
  const toolCompletions = events.filter((event) => event.type === 'tool.completed')
  const requestedChars = requests.map((event) => Number(event.contextChars || 0))
  const usage = completions.map((event) => event.usage).filter(Boolean)
  // eslint-disable-next-line no-console -- developer replay output
  console.log(
    JSON.stringify(
      {
        mode: useRealModel ? 'real-ollama' : 'mock',
        model: useRealModel ? model : 'deterministic-fixture',
        endpoint: useRealModel ? endpoint : undefined,
        elapsedMs: Date.now() - startedAt,
        result,
        modelRequests: requests.length,
        modelDurationsMs: completions.map((event) => event.durationMs),
        contextChars: requestedChars,
        contextCharsTotal: requestedChars.reduce((sum, value) => sum + value, 0),
        tokenUsageKind: useRealModel ? 'provider-reported' : 'estimated-fixture',
        tokenUsage: usage,
        toolCalls: toolCompletions.length,
        toolDurations: toolCompletions.map((event) => ({ name: event.name, durationMs: event.durationMs })),
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- developer replay error output
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
