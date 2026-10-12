/**
 * Prompts never carry earlier conversation turns. The model reads them on demand
 * through `chaya_agent_recall`: whole turns, newest first, never clipped.
 */

export const RECALL_TOOL_NAME = 'chaya_agent_recall'

export const RECALL_TOOL_DESCRIPTION =
  'Read earlier turns of the current Chaya Agent conversation. Prompts do not include earlier turns; call this only when the current request depends on them (for example "continue", "that one", "do it again", "what did you just say"). Without query it returns the latest turns, so the default is the previous turn; with query it returns turns whose request or reply contains any of the terms. Use offset to page further back.'

export const RECALL_TOOL_PROPERTIES = {
  query: { type: 'string', description: 'Search terms separated by spaces (any language); omit to read the latest turns' },
  limit: { type: 'number', description: 'Maximum turns (default 1 without query, 4 with query; up to 8)' },
  offset: { type: 'number', description: 'Skip this many newest matching turns (default 0)' },
} as const

export type RecallTurn = {
  /** Task or turn id */
  id: string
  at: number
  request: string
  reply: string
  /** Final task state when the turn belongs to a task */
  state?: string
}

type Message = { role: string; content: string }

/** Pairs each stored user message with the assistant reply that follows it. */
export function turnsFromMessages(messages: readonly Message[], base: Omit<RecallTurn, 'request' | 'reply'>): RecallTurn[] {
  const turns: RecallTurn[] = []
  let request: string | null = null
  for (const message of messages) {
    if (message.role === 'user') request = message.content
    else if (message.role === 'assistant' && request !== null) {
      turns.push({ ...base, id: `${base.id}:${turns.length}`, request, reply: message.content })
      request = null
    }
  }
  return turns.length === 1 ? [{ ...turns[0], id: base.id }] : turns
}

function count(value: unknown, fallback: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.trunc(value))) : fallback
}

/** `turns` may be in any order; ties keep their input order. */
export function recallTurns(turns: readonly RecallTurn[], args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const limit = Math.max(1, count(args.limit, query ? 4 : 1, 8))
  const offset = count(args.offset, 0, 1_000)
  const matches = turns
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => b.turn.at - a.turn.at || b.index - a.index)
    .map(({ turn }) => turn)
    .filter((turn) => !terms.length || terms.some((term) => `${turn.request}\n${turn.reply}`.toLowerCase().includes(term)))
  const selected = matches.slice(offset, offset + limit)
  return { query: query || null, offset, turns: selected, count: selected.length, more: matches.length > offset + selected.length }
}
