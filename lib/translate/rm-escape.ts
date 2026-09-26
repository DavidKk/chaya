/**
 * RPG Maker 消息/描述控制码（MV/MZ 等）：
 * - `\n[1]` / `\N[1]` 角色名
 * - `\c[16]` / `\C[0]` 文字色
 * - `\I[5]` 图标、`\FS[20]` 字号等
 *
 * 送翻时由 text-classify 换成 `__C0__`；本模块做「数字无关」模板，
 * 使 `\n[1]` 与 `\n[3]` 能命中同一条缓存。
 */

/** `\X[digits]`：反斜杠 + 字母 + 数字方括号（不含 `\C[#rrggbb]` 等） */
const RM_DIGIT_CODE_SRC = String.raw`\\[A-Za-z]+\[\d+\]`

/** 每次新建，避免 `/g` 的 lastIndex 串扰 */
function rmDigitCodeRe(): RegExp {
  return new RegExp(RM_DIGIT_CODE_SRC, 'g')
}

/** 更宽：任意方括号参数，用于切段（与历史 `RM_ESCAPE` 一致） */
export const RM_ESCAPE_RE = /\\[A-Za-z]+(?:\[[^\]]*\])?/g

export function hasRmDigitCodes(text: string): boolean {
  return rmDigitCodeRe().test(String(text ?? ''))
}

export function extractRmDigitCodes(text: string): string[] {
  return [...String(text ?? '').matchAll(rmDigitCodeRe())].map((m) => m[0])
}

/**
 * 数字归一模板：`\n[1]` / `\N[3]` → `\n[#]`（字母小写，便于大小写互通）。
 * 无数字码时原样返回。
 */
export function toRmDigitTemplate(text: string): string {
  const src = String(text ?? '')
  if (!hasRmDigitCodes(src)) return src
  return src.replace(rmDigitCodeRe(), (m) => {
    const letter = m.match(/^\\([A-Za-z]+)/)?.[1] ?? ''
    return `\\${letter.toLowerCase()}[#]`
  })
}

/**
 * 把模板里的 `\x[#]` 按顺序换回本次原文里的具体码。
 * codes 通常来自 {@link extractRmDigitCodes}(原文)。
 */
export function applyRmDigitCodes(template: string, codes: readonly string[]): string {
  if (!codes.length) return String(template ?? '')
  let i = 0
  return String(template ?? '').replace(/\\[A-Za-z]+\[#\]/g, (slot) => {
    const code = codes[i++]
    return code != null ? code : slot
  })
}

/** 查表：有数字码时先精确，再试模板键并还原。 */
export function lookupWithRmDigitTemplate(get: (key: string) => string | null | undefined, text: string): string | null {
  const src = String(text ?? '')
  if (!src) return null
  const direct = get(src)
  if (direct != null && direct !== '') return direct

  const codes = extractRmDigitCodes(src)
  if (!codes.length) return null
  const tpl = toRmDigitTemplate(src)
  if (tpl === src) return null
  const hit = get(tpl)
  if (hit == null || hit === '') return null
  return applyRmDigitCodes(hit, codes)
}
