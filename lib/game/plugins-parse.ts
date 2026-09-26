/** 从 RPG Maker plugins.js 文本解析插件列表（纯解析，不读盘） */

export type PluginsJsEntry = {
  name: string
  status: boolean
  description?: string
  parameters?: Record<string, unknown>
  [key: string]: unknown
}

const PLUGINS_ASSIGN_RE = /(?:(?:var|let|const)\s+)?\$plugins\s*=\s*\[/

/**
 * 定位 `$plugins = [ ... ];`：按括号深度扫描，避免描述/参数里的 `];` 截断非贪婪正则。
 */
export function findPluginsJsArraySpan(raw: string): { blockStart: number; blockEnd: number; arrayStart: number; arrayEnd: number } | null {
  const m = PLUGINS_ASSIGN_RE.exec(raw)
  if (!m) return null

  const arrayStart = m.index + m[0].length - 1
  let depth = 0
  let inString = false
  let escape = false

  for (let i = arrayStart; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '[') {
      depth += 1
      continue
    }
    if (ch === ']') {
      depth -= 1
      if (depth !== 0) continue
      let end = i + 1
      while (end < raw.length && /[ \t\r\n]/.test(raw[end]!)) end += 1
      if (raw[end] === ';') end += 1
      return { blockStart: m.index, blockEnd: end, arrayStart, arrayEnd: i + 1 }
    }
  }
  return null
}

function parseArrayJson(slice: string): PluginsJsEntry[] | null {
  try {
    const list = JSON.parse(slice) as PluginsJsEntry[]
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

export function parsePluginsJs(raw: string): Array<{ name: string; status: boolean }> {
  const span = findPluginsJsArraySpan(raw)
  if (!span) return []
  const list = parseArrayJson(raw.slice(span.arrayStart, span.arrayEnd))
  if (!list) return []
  return list.filter((p) => p && typeof p.name === 'string').map((p) => ({ name: p.name, status: Boolean(p.status) }))
}

/** 解析完整 `$plugins` 数组；失败返回 null */
export function parsePluginsJsEntries(raw: string): { match: string; list: PluginsJsEntry[] } | null {
  const span = findPluginsJsArraySpan(raw)
  if (!span) return null
  const list = parseArrayJson(raw.slice(span.arrayStart, span.arrayEnd))
  if (!list) return null
  return { match: raw.slice(span.blockStart, span.blockEnd), list }
}

export function serializePluginsJs(raw: string, matchBlock: string, list: PluginsJsEntry[]): string {
  return raw.replace(matchBlock, `var $plugins =\n${JSON.stringify(list, null, 2)};`)
}
