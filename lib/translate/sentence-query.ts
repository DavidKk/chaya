/** Query-only views shared by SQLite selection, plugin selection and planning. */
import { buildLogicText, listNewlineSpans } from './logic-text'
import { sentenceBodyKey, sentenceOuterShell, type SentenceUnitOptions, sentenceUnits, wholeSentenceKey } from './sentence-units'

export function sentenceQueryViews(src: string, opts?: SentenceUnitOptions) {
  const views = [{ text: src, offset: 0, opts }]
  if (opts?.structure?.mode === 'disabled') return views
  // Peel only complete outer dialogue shells, never arbitrary nested quotations.
  // The depth bound avoids turning hostile wrapper nesting into unbounded work.
  for (let depth = 0; depth < 8; depth++) {
    const view = views.at(-1)!
    if (!/^\s*[「『“（(]/.test(view.text)) break
    const shell = sentenceOuterShell(view.text)
    if (!shell.lead || !shell.core || shell.core === view.text || /[!?！？]/.test(shell.trail)) break
    const offset = shell.lead.length
    views.push({
      text: shell.core,
      offset: view.offset + offset,
      opts: {
        ...view.opts,
        newlines: view.opts?.newlines?.filter((n) => n.start >= offset && n.end <= offset + shell.core.length).map((n) => ({ ...n, start: n.start - offset, end: n.end - offset })),
      },
    })
  }
  return views
}

export function queryLines(src: string) {
  const breaks = listNewlineSpans(src)
  if (!breaks.length || breaks.length > 200) return []
  let start = 0
  return [...breaks, { start: src.length, end: src.length }].flatMap((br) => {
    const raw = src.slice(start, br.start)
    const at = start + (raw.match(/^\s*/)?.[0].length || 0)
    start = br.end
    return raw.trim() ? [{ start: at, text: raw.trim() }] : []
  })
}

/** Split the complete outer dialogue while keeping its visible shell on the edge units.
 * Stored record units keep their original rules; nested quotations remain protected.
 */
export function sentenceQueryViewUnits(src: string, opts?: SentenceUnitOptions) {
  const body = sentenceQueryViews(src, opts)[1]
  if (!body) return sentenceUnits(src, opts)
  const units = sentenceUnits(body.text, body.opts)
  if (units.length < 2) return sentenceUnits(src, opts)
  return units.map((unit, i) => ({
    ...unit,
    start: i === 0 ? 0 : unit.start + body.offset,
    end: i === units.length - 1 ? src.length : unit.end + body.offset,
    key: sentenceBodyKey((i === 0 ? src.slice(0, body.offset).trimStart() : '') + unit.key + (i === units.length - 1 ? src.slice(body.offset + body.text.length).trimEnd() : '')),
  }))
}

export function sentenceQueryKeys(src: string, opts?: SentenceUnitOptions): string[] {
  return [
    ...new Set(
      sentenceQueryViews(src, opts).flatMap((view) => [
        wholeSentenceKey(view.text),
        wholeSentenceKey(buildLogicText(view.text, view.opts).logic),
        ...sentenceQueryViewUnits(view.text, view.opts).map((unit) => wholeSentenceKey(view.text.slice(unit.start, unit.end))),
        ...queryLines(view.text).map((line) => wholeSentenceKey(line.text)),
      ])
    ),
  ]
}

export function sentenceQueryUnits(src: string, opts?: SentenceUnitOptions) {
  return sentenceQueryViews(src, opts).flatMap((view) =>
    sentenceQueryViewUnits(view.text, view.opts).map((u) => ({ ...u, start: u.start + view.offset, end: u.end + view.offset }))
  )
}

/** A bounded candidate prefilter; final equality still normalizes actual keys. */
export function ellipsisQueryGlob(key: string): string | null {
  if (!key.includes('...')) return null
  return key
    .split('...')
    .map((part) => part.replace(/[?*\[]/g, (c) => (c === '[' ? '[[]' : `[${c}]`)))
    .join('*')
}
