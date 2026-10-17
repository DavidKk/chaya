/** GetInformation substitutes these fixed tokens before drawTextEx runs. */
export const DYNAMIC_VARIABLE = /_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])/g

export function isDynamicTemplate(text: string): boolean {
  return new RegExp(DYNAMIC_VARIABLE.source).test(text)
}

function sortedTokens(text: string, re: RegExp): string {
  return JSON.stringify((text.match(re) || []).sort())
}

const CONTROLS = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|_se\[[^\]]*\]/g

/** Imported translations obey the same contract as engine output, including line boundaries. */
export function validDynamicTranslation(source: string, target: string): boolean {
  if (!isDynamicTemplate(source)) return true
  const lines = source.split(/\\n|\r?\n/)
  const translated = target.split(/\\n|\r?\n/)
  return (
    lines.length === translated.length &&
    lines.every(
      (line, i) =>
        sortedTokens(line, /_[A-Za-z][A-Za-z0-9_]*/g) === sortedTokens(translated[i], /_[A-Za-z][A-Za-z0-9_]*/g) &&
        sortedTokens(line, DYNAMIC_VARIABLE) === sortedTokens(translated[i], DYNAMIC_VARIABLE) &&
        sortedTokens(line, CONTROLS) === sortedTokens(translated[i], CONTROLS)
    )
  )
}

type Template = { re: RegExp; variables: string[]; translated: string }
export type DynamicValues = Record<string, ReadonlySet<string>>
const numeric = new Set(['_num', '_icon', '_aicon'])
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Index complete templates and their display lines. Never use unanchored text replacement. */
export function createDynamicTemplateIndex() {
  const templates = new Map<string, Template[]>()
  function notePair(source: string, translated: string) {
    if (!isDynamicTemplate(source) || !translated || !validDynamicTranslation(source, translated)) return
    // The plugin consumes its optional sound directive before it reaches rendering.
    const srcBody = source.replace(/^_se\[[^\]]*\]/i, '')
    const zhBody = translated.replace(/^_se\[[^\]]*\]/i, '')
    const pairs = [[srcBody, zhBody]]
    const lines = srcBody.split(/\\n|\r?\n/)
    const zhLines = zhBody.split(/\\n|\r?\n/)
    if (lines.length > 1) lines.forEach((line, i) => pairs.push([line, zhLines[i]]))
    const compiled: Template[] = []
    for (const [src, zh] of pairs) {
      if (!isDynamicTemplate(src)) continue
      const variables: string[] = []
      let offset = 0
      let pattern = '^'
      for (const match of src.matchAll(DYNAMIC_VARIABLE)) {
        pattern += escapeRegex(src.slice(offset, match.index))
        const previous = variables.indexOf(match[0])
        pattern += previous >= 0 ? `\\${previous + 1}` : numeric.has(match[0]) ? '([0-9]+)' : '([^\\r\\n]{0,1200}?)'
        if (previous < 0) variables.push(match[0])
        offset = match.index! + match[0].length
      }
      pattern += escapeRegex(src.slice(offset)) + '$'
      compiled.push({ re: new RegExp(pattern), variables, translated: zh })
    }
    templates.set(source, compiled)
  }
  return {
    get size() {
      return templates.size
    },
    notePair,
    clear: () => templates.clear(),
    resolve(text: string, values: DynamicValues | (() => DynamicValues), translate: (value: string) => string): string | null {
      // A name/description must come from game data. Numeric captures are bounded by template literals.
      if (text.length > 8192) return null
      const prefix = text.match(/^(?:\\FS\[\d+\])+/i)?.[0] || ''
      const body = text.slice(prefix.length)
      const results = new Set<string>()
      let allowed: DynamicValues | undefined
      for (const group of templates.values())
        for (const template of group) {
          const match = template.re.exec(body)
          if (!match) continue
          allowed ??= typeof values === 'function' ? values() : values
          const accepted = allowed
          const captured: Record<string, string> = Object.create(null)
          let valid = true
          template.variables.forEach((variable, i) => {
            const value = match[i + 1]
            if (!numeric.has(variable) && !accepted[variable]?.has(value)) valid = false
            captured[variable] = numeric.has(variable) ? value : translate(value)
          })
          if (valid) results.add(template.translated.replace(DYNAMIC_VARIABLE, (variable) => captured[variable]))
          if (results.size > 1) return null
        }
      return results.size === 1 ? prefix + [...results][0] : null
    },
  }
}
