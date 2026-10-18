/** Query-only views shared by SQLite selection, plugin selection and planning. */
import { buildLogicText, listNewlineSpans } from './logic-text'
import { sentenceOuterShell, type SentenceUnitOptions, sentenceUnits, wholeSentenceKey } from './sentence-units'

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

export function sentenceQueryKeys(src: string, opts?: SentenceUnitOptions): string[] {
  return [
    ...new Set(
      sentenceQueryViews(src, opts).flatMap((view) => [
        wholeSentenceKey(view.text),
        wholeSentenceKey(buildLogicText(view.text, view.opts).logic),
        ...queryLines(view.text).map((line) => wholeSentenceKey(line.text)),
      ])
    ),
  ]
}

export function sentenceQueryUnits(src: string, opts?: SentenceUnitOptions) {
  return sentenceQueryViews(src, opts).flatMap((view) => sentenceUnits(view.text, view.opts).map((u) => ({ ...u, start: u.start + view.offset, end: u.end + view.offset })))
}
