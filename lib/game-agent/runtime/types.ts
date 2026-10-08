export type AgentCapability = 'play' | 'ask' | 'companion'
export type RuntimeMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_name?: string; tool_calls?: RuntimeToolCall[] }
export type RuntimeToolCall = { id?: string; function: { name: string; arguments: Record<string, unknown> } }
export type RuntimeTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; groups?: string[] }
export type RuntimeEvent =
  | { type: 'phase'; phase: 'observing' | 'thinking' | 'acting' | 'verifying'; step: number; maxSteps: number }
  | { type: 'tool.started' | 'tool.completed'; name: string; callId: string; ok?: boolean }

export type AgentHost = {
  model: { complete: (messages: RuntimeMessage[], tools: RuntimeTool[], signal: AbortSignal) => Promise<RuntimeMessage> }
  tools: { list: () => Promise<RuntimeTool[]> | RuntimeTool[]; call: (name: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> }
  store: { append: (messages: RuntimeMessage[]) => Promise<void> | void }
  events: { emit: (event: RuntimeEvent) => void }
  clock: { now: () => number }
}

export type RuntimeCapabilityConfig = {
  capability: AgentCapability
  maxSteps: number
  maxToolCalls: number
  allowTool: (tool: RuntimeTool) => boolean
}

export type TurnResult = { text: string; steps: number; toolCalls: number; reason: 'answered' | 'limit' | 'no_progress' | 'unsupported' }
