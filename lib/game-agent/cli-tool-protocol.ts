import type { RuntimeMessage, RuntimeTool, RuntimeToolCall } from './runtime/types'

const MAX_MESSAGE_CHARS = 12_000
const BLOB_PATTERN = /[A-Za-z0-9+/=]{2000,}/g

const BASE_RULES = [
  'You are the language model behind Chaya, an in-game RPG assistant. Chaya runs the conversation loop and executes tools for you.',
  'You have no built-in tools here: never run shell commands, read or write files, browse the web, or use any tool your own client offers. Answer only from the conversation below.',
]

const TOOL_RULES = [
  'Reply with exactly one JSON object and nothing else (no Markdown fences, no prose around it):',
  '{"reply": "<player-visible text>", "tool_calls": [{"name": "<tool name>", "arguments": {}}]}',
  '- To act, list the calls in "tool_calls"; they run in order and their results arrive in the next message. Keep "reply" short or empty while acting.',
  '- When no tool is needed or the work is done, return "tool_calls": [] and put the final answer in "reply".',
  '- Only use tool names from <tools>; "arguments" must follow the tool\'s JSON schema.',
]

function stripOllamaHints(text: string) {
  return text.replace(/^\/no_think\s*\n?/, '')
}

function clip(text: string) {
  const compact = stripOllamaHints(text).replace(BLOB_PATTERN, '[binary omitted]')
  return compact.length <= MAX_MESSAGE_CHARS ? compact : `${compact.slice(0, MAX_MESSAGE_CHARS)}…[truncated]`
}

function renderMessage(message: RuntimeMessage) {
  if (message.role === 'tool') return `[tool result${message.tool_name ? `: ${message.tool_name}` : ''}]\n${clip(message.content)}`
  if (message.role === 'assistant') {
    const calls = message.tool_calls?.length
      ? `\n${JSON.stringify({ tool_calls: message.tool_calls.map((call) => ({ name: call.function.name, arguments: call.function.arguments })) })}`
      : ''
    return `[assistant]\n${clip(message.content)}${calls}`
  }
  return `[${message.role}]\n${clip(message.content)}`
}

/**
 * Turns one model round into plain text for CLI agents that cannot take native tool definitions. The CLI never gets
 * tools of its own; Chaya parses the requested calls and runs them through the same loop as Ollama.
 */
export function renderCliPrompt(messages: RuntimeMessage[], tools: RuntimeTool[]): { instructions: string; prompt: string } {
  const system = messages.filter((message) => message.role === 'system').map((message) => stripOllamaHints(message.content).trim())
  const rules = tools.length
    ? [...BASE_RULES, ...TOOL_RULES]
    : [...BASE_RULES, 'Use the output format the instructions below ask for; otherwise reply with plain player-visible text.']
  const toolList = tools.length
    ? `<tools>\n${tools.map((tool) => JSON.stringify({ name: tool.name, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } })).join('\n')}\n</tools>`
    : ''
  const instructions = [rules.join('\n'), ...system, toolList].filter(Boolean).join('\n\n')
  const conversation = messages
    .filter((message) => message.role !== 'system')
    .map(renderMessage)
    .join('\n\n')
  return { instructions, prompt: `<conversation>\n${conversation}\n</conversation>\n\nRespond to the latest message.` }
}

function unfence(text: string) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

/** Pulls model reasoning out of the player-visible reply. The reasoning is kept for the chat log, not sent back as context. */
export function splitThought(text: string): { thought: string; reply: string } {
  const thoughts: string[] = []
  const take = (body: string) => {
    const trimmed = body.trim()
    if (trimmed) thoughts.push(trimmed)
    return ''
  }
  // Some CLI providers escape the closing tag as `\\</think>` or `<\\/think>`.
  // Normalize only tag syntax so the provider's actual answer remains untouched.
  const normalized = text
    .replace(/<\\\/think>/gi, '</think>')
    .replace(/\\<\/think>/gi, '</think>')
    .replace(/&lt;\\?\/?think&gt;/gi, (tag) => (tag.toLowerCase().includes('/think') ? '</think>' : '<think>'))
  const reply = normalized
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_, body: string) => take(body))
    .replace(/<think>([\s\S]*)$/i, (_, body: string) => take(body))
    .replace(/^([\s\S]*?)<\/think>/i, (_, body: string) => take(body))
  return { thought: thoughts.join('\n\n'), reply: reply.trim() }
}

function jsonCandidate(trimmed: string): unknown {
  for (const candidate of [trimmed, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)]) {
    if (!candidate.startsWith('{')) continue
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Accepts the JSON envelope from `renderCliPrompt`; anything else is treated as a plain final answer. */
export function parseCliReply(text: string): RuntimeMessage {
  const outer = splitThought(unfence(text))
  const parsed = jsonCandidate(outer.reply) as { reply?: unknown; tool_calls?: unknown } | null
  const withThought = (content: string, extra?: Pick<RuntimeMessage, 'tool_calls'>): RuntimeMessage => {
    const inner = splitThought(content)
    const thought = [outer.thought, inner.thought].filter(Boolean).join('\n\n')
    return { role: 'assistant', content: inner.reply, ...(thought ? { thought } : {}), ...extra }
  }
  if (!parsed || typeof parsed !== 'object' || (!('reply' in parsed) && !('tool_calls' in parsed))) return withThought(outer.reply)
  const calls: RuntimeToolCall[] = (Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []).flatMap((raw: unknown) => {
    const call = raw as { name?: unknown; arguments?: unknown }
    const name = typeof call?.name === 'string' ? call.name.trim() : ''
    if (!name) return []
    const args = call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments) ? (call.arguments as Record<string, unknown>) : {}
    return [{ function: { name, arguments: args } }]
  })
  return withThought(typeof parsed.reply === 'string' ? parsed.reply.trim() : '', calls.length ? { tool_calls: calls } : undefined)
}
