import { parsePluginsJsEntries } from '@/lib/game/plugins-parse'

import { extractNoteText, isTechnicalField } from './data-fields'
import { clean, isUseful } from './text'

const MAX_NODES = 5_000
const MAX_TEXT_LENGTH = 1_200
const MAX_JSON_LENGTH = 1_000_000

/** Plugin parameters and MZ plugin-command arguments can contain JSON encoded as strings. */
export function extractPluginText(value: unknown): string[] {
  const found = new Set<string>()
  let visited = 0
  const walk = (entry: unknown, depth: number, field = '') => {
    if (depth > 12 || ++visited > MAX_NODES) return
    if (isTechnicalField(field)) return
    if (field === 'note') {
      for (const line of extractNoteText(entry)) found.add(line)
      return
    }
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item, depth + 1, field)
      return
    }
    if (entry && typeof entry === 'object') {
      for (const [key, item] of Object.entries(entry)) walk(item, depth + 1, key)
      return
    }
    if (typeof entry !== 'string') return
    const text = clean(entry)
    if (!text) return
    if (text.length <= MAX_JSON_LENGTH && ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) {
      try {
        walk(JSON.parse(text), depth + 1, field)
        return
      } catch {
        // A malformed encoded value may still be ordinary visible text.
      }
    }
    if (text.length <= MAX_TEXT_LENGTH && isUseful(text)) found.add(text)
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
