/**
 * 条件选项脚本后缀：`标签if(s[n])en(true&&!s[m])`
 * 插件靠 ASCII `if`/`en` 剥条件；整句送翻会把关键字译成「如果/启用」导致露馅。
 */

const META_NAMES = ['if', 'en'] as const

/** 从末尾剥一组 `if(...)` / `en(...)`（括号平衡）。 */
function peelOneTrailingCall(text: string): { core: string; trail: string } | null {
  const s = String(text ?? '')
  if (!s.endsWith(')')) return null

  let depth = 0
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]
    if (ch === ')') depth += 1
    else if (ch === '(') {
      depth -= 1
      if (depth !== 0) continue
      for (const name of META_NAMES) {
        const start = i - name.length
        if (start < 0) continue
        if (s.slice(start, i).toLowerCase() !== name) continue
        // 名称左侧应为标签字符或行首，避免误伤英文单词中间
        if (start > 0) {
          const prev = s[start - 1]!
          if (/[A-Za-z0-9_]/.test(prev)) continue
        }
        return { core: s.slice(0, start), trail: s.slice(start) }
      }
      return null
    }
  }
  return null
}

/** 反复剥尾部 `if`/`en` 调用，保留原始大小写与参数。 */
export function peelChoiceMetaTrail(text: string): { core: string; trail: string } {
  let core = String(text ?? '')
  let trail = ''
  for (;;) {
    const hit = peelOneTrailingCall(core)
    if (!hit) break
    core = hit.core
    trail = hit.trail + trail
  }
  return { core, trail }
}

export function hasChoiceMetaTrail(text: string): boolean {
  return peelChoiceMetaTrail(text).trail.length > 0
}
