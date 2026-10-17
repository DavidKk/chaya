/** Recognize choice conditions only at the edges; preserve parentheses, quotes and escapes without evaluating expressions. */
function callEnd(text: string, start: number): number | null {
  const name = /^(?:if|en)\s*\(/i.exec(text.slice(start))
  if (!name) return null
  let depth = 1
  let quote = ''
  for (let i = start + name[0].length; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i + 1
  }
  return null
}

/** Compatibility helper that removes trailing conditions only. */
export function peelChoiceMetaTrail(text: string): { core: string; trail: string } {
  let core = String(text ?? '')
  let trail = ''
  for (;;) {
    const end = core.trimEnd().length
    let start: number | null = null
    for (const match of core.matchAll(/(?:if|en)\s*\(/gi)) {
      const at = match.index!
      if (at > 0 && /[A-Za-z0-9_]/.test(core[at - 1])) continue
      if (callEnd(core, at) === end) {
        start = at
        break
      }
    }
    if (start == null) break
    // Include adjacent whitespace in the shell so restoration preserves every character.
    start = core.slice(0, start).trimEnd().length
    trail = core.slice(start) + trail
    core = core.slice(0, start)
  }
  return { core, trail }
}

/** Repeatedly remove leading and trailing conditions; leave matching text inside the body untouched. */
export function peelChoiceMetaShell(text: string): { lead: string; core: string; trail: string } {
  const trailing = peelChoiceMetaTrail(text)
  let core = trailing.core
  const trail = trailing.trail
  let lead = ''
  for (;;) {
    const start = core.length - core.trimStart().length
    const end = callEnd(core, start)
    if (end == null) break
    const next = end + (core.slice(end).match(/^\s*/)?.[0].length || 0)
    lead += core.slice(0, next)
    core = core.slice(next)
  }
  return { lead, core, trail }
}

export function hasChoiceMetaTrail(text: string): boolean {
  return peelChoiceMetaTrail(text).trail.length > 0
}
