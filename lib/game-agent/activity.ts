export type AgentTokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cachedInput?: number
  total?: number
}

/** Provider-native timings; Ollama reports nanoseconds. UI should convert explicitly. */
export type AgentModelTiming = {
  loadDurationNs?: number
  promptEvalDurationNs?: number
  evalDurationNs?: number
  totalDurationNs?: number
}

export type AgentThoughtSummary = {
  observation?: string
  decision?: string
  plan?: string
  result?: string
  next?: string
}

export type AgentActivityEvent = { seq: number; type: string; at?: number; data?: unknown; correlation?: { actionId?: string; toolCallId?: string } }

const SECRET_KEY = /authorization|cookie|token|secret|password|api[-_]?key/i
const SECRET_TEXT = /(bearer\s+)[\w.+\-/=]+|((?:token|secret|password|api[-_]?key)\s*[:=]\s*)[^\s,;]+/gi
const LOCAL_PATH = /(?:\/(?:Users|home|root|private|tmp|var|opt|Volumes)(?:\/[^\s/]+)?|[A-Za-z]:\\Users\\[^\s\\]+)(?:[/\\][^\s"']+)*/g
const MAX_TEXT = 16_000

export function sanitizeAgentText(value: string): string {
  return value
    .replace(SECRET_TEXT, (_match, bearer, assignment) => `${bearer || assignment || ''}[REDACTED]`)
    .replace(LOCAL_PATH, '<local-path>')
    .slice(0, MAX_TEXT)
}

export function sanitizeAgentActivity(value: unknown, secrets: Iterable<string> = []): unknown {
  const secretValues = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)
  const seen = new WeakSet<object>()
  const walk = (item: unknown, depth: number): unknown => {
    if (typeof item === 'string') {
      let text = sanitizeAgentText(item)
      for (const secret of secretValues) text = text.split(secret).join('[REDACTED]')
      return text
    }
    if (item == null || typeof item === 'number' || typeof item === 'boolean') return item
    if (typeof item !== 'object') return String(item).slice(0, MAX_TEXT)
    if (depth >= 6) return '[TRUNCATED]'
    if (seen.has(item)) return '[CIRCULAR]'
    seen.add(item)
    if (Array.isArray(item)) return item.slice(0, 100).map((entry) => walk(entry, depth + 1))
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(item).slice(0, 100)) result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : walk(entry, depth + 1)
    return result
  }
  return walk(value, 0)
}

export function addTokenUsage(current: AgentTokenUsage | undefined, next: AgentTokenUsage | undefined): AgentTokenUsage | undefined {
  if (!next) return current
  const keys = ['input', 'output', 'reasoning', 'cachedInput', 'total'] as const
  const merged: AgentTokenUsage = { ...current }
  for (const key of keys) if (typeof next[key] === 'number') merged[key] = (merged[key] || 0) + next[key]!
  return merged
}
