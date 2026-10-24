import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { findNameSpans, isLiteralNameGap, isZhNameTarget, type NameEntry, nameGaps, type NameSpan, stitchNameLocks } from '@/lib/translate/name-glossary'
import { shouldTranslate } from '@/services/translate/text-classify'

export type LockedNamePlan = {
  spans: NameSpan[]
  gaps: ReturnType<typeof nameGaps>
  translatable: ReturnType<typeof nameGaps>
  wholeName: boolean
}

export function planLockedNames(src: string, entries: readonly NameEntry[], opts?: { sourceLang?: string; targetLang?: string }): LockedNamePlan | null {
  if (!entries.length || (opts?.targetLang && !isZhNameTarget(opts.targetLang))) return null
  const { core } = peelChoiceMetaShell(src)
  const body = core || src
  const offset = src.indexOf(body)
  const spans = findNameSpans(body, entries, opts?.targetLang).map((span) => ({
    ...span,
    start: span.start + Math.max(0, offset),
    end: span.end + Math.max(0, offset),
  }))
  if (!spans.length) return null
  const gaps = nameGaps(src, spans)
  const translatable = gaps.filter((gap) => !isLiteralNameGap(gap.text) && shouldTranslate(gap.text, opts?.sourceLang))
  const wholeName = spans.length === 1 && spans[0].start === 0 && spans[0].end === src.length && !translatable.length
  return { spans, gaps, translatable, wholeName }
}

export function stitchLockedNamePlan(src: string, plan: LockedNamePlan, gapZh: ReadonlyMap<string, string>): string {
  const filled = new Map(gapZh)
  for (const gap of plan.gaps) {
    if (!filled.has(gap.id)) filled.set(gap.id, gap.text)
  }
  return stitchNameLocks(src, plan.spans, filled)
}
