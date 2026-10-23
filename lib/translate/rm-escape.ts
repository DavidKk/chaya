/** RPG Maker message and description controls: actor names, colors, icons and font sizes. text-classify masks these as __C0__; numeric templates let different actor IDs reuse the same cached translation. */

/** Backslash, letters and a numeric bracket argument; excludes hexadecimal color arguments. */
const RM_DIGIT_CODE_SRC = String.raw`\\[A-Za-z]+\[\d+\]`

/** Create a fresh expression to avoid sharing the global lastIndex state. */
function rmDigitCodeRe(): RegExp {
  return new RegExp(RM_DIGIT_CODE_SRC, 'g')
}

/** Accept arbitrary bracket arguments when splitting controls, matching the legacy RM_ESCAPE behavior. */
export const RM_ESCAPE_RE = /\\[A-Za-z]+(?:\[[^\]]*\])?/g

/**
 * Semantic placeholder tokens carry variable content (actor names, variables, formatted values, template slots)
 * and must remain part of the sentence body rather than being peeled as decorative boundary shells.
 */
export function isSemanticPlaceholder(token: string): boolean {
  if (!token) return false
  // RPG Maker actor/party/variable/gold: \N[digits], \P[digits], \V[digits], \G
  if (/^\\[NPV]\[[^\]]*\]$/i.test(token) || /^\\[Gg]$/.test(token)) return true
  // C-style printf format tokens: %s, %d, %i, %f, %S, %c, %1, %2, etc.
  if (/^%[0-9]+$/i.test(token) || /^%[sdifSc]$/.test(token)) return true
  // Braced template parameters: {name}, {0}, etc.
  if (/^\{[0-9A-Za-z_]+\}$/.test(token)) return true
  // Script / engine token placeholders: _actor, _name, _class, _num, actor[1], etc.
  if (/^_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])/i.test(token)) return true
  if (/^[A-Za-z_][A-Za-z0-9_]*\[\d+\]$/.test(token)) return true
  return false
}

export function hasRmDigitCodes(text: string): boolean {
  return rmDigitCodeRe().test(String(text ?? ''))
}

export function extractRmDigitCodes(text: string): string[] {
  return [...String(text ?? '').matchAll(rmDigitCodeRe())].map((m) => m[0])
}

/** Normalize numeric controls to lowercase templates such as actor-name slots with [#]. Return other text unchanged. */
export function toRmDigitTemplate(text: string): string {
  const src = String(text ?? '')
  if (!hasRmDigitCodes(src)) return src
  return src.replace(rmDigitCodeRe(), (m) => {
    const letter = m.match(/^\\([A-Za-z]+)/)?.[1] ?? ''
    return `\\${letter.toLowerCase()}[#]`
  })
}

/** Restore numbered control slots in order using codes from {@link extractRmDigitCodes}. */
export function applyRmDigitCodes(template: string, codes: readonly string[]): string {
  if (!codes.length) return String(template ?? '')
  let i = 0
  return String(template ?? '').replace(/\\[A-Za-z]+\[#\]/g, (slot) => {
    const code = codes[i++]
    return code != null ? code : slot
  })
}

/** Try an exact lookup first, then a numeric template and restore the original codes. */
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
