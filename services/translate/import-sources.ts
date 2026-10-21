/** Normalize MCP / API source-string JSON into stable keyed entries for async sources jobs. */

export type SourcesInputFormat = 'array' | 'ast' | 'object'

export type SourcesEntryState = 'pending' | 'done' | 'failed' | 'cached'

export type SourcesEntry = {
  key: string
  src: string
  zh: string
  state: SourcesEntryState
  line?: number
  /** Original AST `key` field when present (e.g. message / label). */
  field?: string
}

export type NormalizedSources = {
  format: SourcesInputFormat
  entries: SourcesEntry[]
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0')
}

function isAstItem(value: unknown): value is { id?: unknown; key?: unknown; text?: unknown; line?: unknown } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'text' in (value as object))
}

/** Parse import payload: string array, AST items, or { src: zh } object. */
export function normalizeSourcesInput(text: string): NormalizedSources {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) throw new Error('text cannot be empty')

  let raw: unknown
  try {
    raw = JSON.parse(trimmed) as unknown
  } catch {
    throw new Error('text must be valid JSON')
  }

  if (Array.isArray(raw)) {
    if (!raw.length) throw new Error('text array cannot be empty')
    if (raw.every((item) => typeof item === 'string')) {
      const entries: SourcesEntry[] = []
      const seenSrc = new Set<string>()
      let i = 0
      for (const item of raw) {
        const src = String(item ?? '')
        if (!src.trim() || seenSrc.has(src)) continue
        seenSrc.add(src)
        i += 1
        entries.push({ key: `src_${pad(i)}`, src, zh: '', state: 'pending' })
      }
      if (!entries.length) throw new Error('no source strings found in array')
      return { format: 'array', entries }
    }
    if (raw.every(isAstItem)) {
      const entries: SourcesEntry[] = []
      const seenKey = new Set<string>()
      let i = 0
      for (const item of raw) {
        const src = typeof item.text === 'string' ? item.text : ''
        if (!src.trim()) continue
        i += 1
        let key = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `src_${pad(i)}`
        if (seenKey.has(key)) key = `${key}_${pad(i)}`
        seenKey.add(key)
        const line = typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : undefined
        const field = typeof item.key === 'string' ? item.key : undefined
        entries.push({ key, src, zh: '', state: 'pending', ...(line != null ? { line } : {}), ...(field ? { field } : {}) })
      }
      if (!entries.length) throw new Error('no source strings found in AST items')
      return { format: 'ast', entries }
    }
    throw new Error('array must be string[] or AST items with text')
  }

  if (raw && typeof raw === 'object') {
    const entries: SourcesEntry[] = []
    for (const [src, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!src.trim()) continue
      const zh = value == null ? '' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
      entries.push({
        key: src,
        src,
        zh,
        state: zh.trim() ? 'done' : 'pending',
      })
    }
    if (!entries.length) throw new Error('no source strings found in object')
    return { format: 'object', entries }
  }

  throw new Error('unsupported JSON shape for sources import')
}

/** Build export payload matching the original import format. */
export function exportSourcesPayload(format: SourcesInputFormat, entries: SourcesEntry[], opts?: { onlyDone?: boolean }): unknown {
  const list = opts?.onlyDone ? entries.filter((e) => e.state === 'done' || e.state === 'cached') : entries
  if (format === 'object') {
    const map: Record<string, string> = Object.create(null)
    for (const e of list) map[e.src] = e.zh || ''
    return map
  }
  if (format === 'ast') {
    return list.map((e) => ({
      id: e.key,
      ...(e.field ? { key: e.field } : {}),
      text: e.src,
      zh: e.zh || '',
      state: e.state,
      ...(e.line != null ? { line: e.line } : {}),
    }))
  }
  return list.map((e) => ({ key: e.key, src: e.src, zh: e.zh || '', state: e.state }))
}
