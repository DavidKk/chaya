import { parsePluginsJsEntries } from '@/lib/game/plugins-parse'

import { clean, isUseful } from './text'

const MAX_NODES = 5_000
const MAX_TEXT_LENGTH = 1_200
const MAX_JSON_LENGTH = 1_000_000
const CODE_START = /^\s*(?:function\b|(?:async\s+)?(?:function|return|if|for|while|const|let|var)\b|\(?[\w,\s]*\)?\s*=>)/

/** Plugin parameters and MZ plugin-command arguments can contain JSON encoded as strings. */
export function extractPluginText(value: unknown): string[] {
  const found = new Set<string>()
  let visited = 0
  const walk = (entry: unknown, depth: number) => {
    if (depth > 12 || ++visited > MAX_NODES) return
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item, depth + 1)
      return
    }
    if (entry && typeof entry === 'object') {
      for (const item of Object.values(entry)) walk(item, depth + 1)
      return
    }
    if (typeof entry !== 'string') return
    const text = clean(entry)
    if (!text) return
    if (text.length <= MAX_JSON_LENGTH && ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) {
      try {
        walk(JSON.parse(text), depth + 1)
        return
      } catch {
        // A malformed encoded value may still be ordinary visible text.
      }
    }
    if (text.length <= MAX_TEXT_LENGTH && isUseful(text) && !CODE_START.test(text)) found.add(text)
  }
  walk(value, 0)
  return [...found]
}

export function extractPluginsJsText(raw: string): string[] {
  const parsed = parsePluginsJsEntries(raw)
  if (!parsed) return []
  const found = new Set<string>()
  for (const plugin of parsed.list) {
    if (!plugin?.status || !plugin.parameters) continue
    for (const text of extractPluginText(plugin.parameters)) found.add(text)
  }
  return [...found]
}
