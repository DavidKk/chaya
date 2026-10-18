'use client'

import { useEffect, useRef, useState } from 'react'
import { IoChevronForwardOutline, IoContractOutline, IoExpandOutline } from 'react-icons/io5'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { formCard, formDesc, formTitle } from '@/components/layoutClasses'
import { Badge, Button } from '@/components/sk'
import type { CacheMatchTrace } from '@/lib/translate/cache-match-trace'
import { sentenceUnits } from '@/lib/translate/sentence-units'

import { CACHE_TEST_COPY } from './cache-test-copy'

export function CacheMatchTraceView({ trace }: { trace: CacheMatchTrace }) {
  const copy = CACHE_TEST_COPY[useLocaleCode()],
    labels = copy.trace
  const section = useRef<HTMLElement>(null)
  const [allExpanded, setAllExpanded] = useState(false)
  const toggleLabel = allExpanded ? labels.collapseAll : labels.expandAll
  const updateExpanded = () => {
    const details = [...(section.current?.querySelectorAll('details') || [])]
    setAllExpanded(details.length > 0 && details.every((detail) => detail.open))
  }
  const toggleAll = () => {
    const next = !allExpanded
    section.current?.querySelectorAll('details').forEach((detail) => {
      detail.open = next
    })
    setAllExpanded(next)
  }
  useEffect(() => {
    const el = section.current
    if (!el) return
    el.addEventListener('toggle', updateExpanded, true)
    return () => el.removeEventListener('toggle', updateExpanded, true)
  }, [])
  const reason = (code: string) => copy.reasons[code] || code
  return (
    <section ref={section} className={formCard} aria-label={labels.title}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className={formTitle}>{labels.title}</h2>
          <p className={formDesc}>{labels.help}</p>
        </div>
        <Button
          variant="plain"
          size="icon"
          className="shrink-0"
          aria-label={toggleLabel}
          aria-expanded={allExpanded}
          tooltip={toggleLabel}
          disabled={!trace.paths.length}
          onClick={toggleAll}
        >
          {allExpanded ? <IoContractOutline size={16} aria-hidden /> : <IoExpandOutline size={16} aria-hidden />}
        </Button>
      </div>
      {trace.limited ? (
        <p className="m-0 text-sm text-warn" role="status">
          {labels.limited}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {trace.paths.map((path, index) => (
          <li key={path.id} className="min-w-0 border-t border-line pt-3">
            <details className="group/path">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink [&::-webkit-details-marker]:hidden">
                <IoChevronForwardOutline size={16} className="shrink-0 group-open/path:rotate-90" aria-hidden />
                <span>
                  {index + 1}. {labels.kinds[path.kind]} · {labels.view}: {path.offset ? labels.body : labels.raw}
                </span>
              </summary>
              <div className="mt-3 flex min-w-0 flex-col gap-3 pl-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={path.status === 'full' ? 'info' : 'warn'}>{copy[path.status]}</Badge>
                  <Badge tone={path.adopted ? 'info' : 'warn'}>{!path.applicable ? labels.unavailable : path.adopted ? labels.adopted : labels.alternative}</Badge>
                  {path.ambiguous ? <Badge tone="warn">{copy.ambiguous}</Badge> : null}
                  {path.limited ? <span className="text-xs text-warn">{labels.limited}</span> : null}
                </div>
                <pre className="m-0 whitespace-pre-wrap break-words text-xs text-ink-soft">{path.text}</pre>
                <details className="group/keys">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-ink-soft [&::-webkit-details-marker]:hidden">
                    <IoChevronForwardOutline size={14} className="shrink-0 group-open/keys:rotate-90" aria-hidden />
                    {labels.lookupKeys}
                  </summary>
                  <pre className="m-0 mt-1 whitespace-pre-wrap break-all pl-5 text-xs text-ink-soft">{path.lookupKeys.join('\n')}</pre>
                </details>
                <div className="flex flex-col gap-1">
                  <h3 className={formTitle}>{labels.units}</h3>
                  {path.units.map((unit, i) => (
                    <div key={`${unit.start}:${unit.end}`} className="min-w-0 text-xs text-ink-soft">
                      <p className="m-0 whitespace-pre-wrap break-words text-ink">
                        {i + 1}. [{unit.start + path.offset}, {unit.end + path.offset}) {path.text.slice(unit.start, unit.end)}
                      </p>
                      <code className="whitespace-pre-wrap break-all">
                        {unit.key} · {unit.tone || '∅'} · {unit.boundary}
                      </code>
                    </div>
                  ))}
                </div>
                {path.reasons.map((code) => (
                  <p key={code} className="m-0 text-xs text-warn">
                    {reason(code)}
                  </p>
                ))}
                {path.alternatives.length ? (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {path.alternatives.map((match, i) => {
                      const record = trace.records[match.recordRef]
                      const chosen = path.matches.some((m) => m.recordRef === match.recordRef && m.start === match.start && m.end === match.end && m.text === match.text)
                      return (
                        <li key={`${match.recordRef}:${match.start}:${match.end}:${i}`} className="min-w-0 text-xs text-ink">
                          <p className="m-0 text-ink-soft">
                            #{record.id} · r{record.revision} · {chosen ? labels.chosen : labels.unused} · {match.kind}
                          </p>
                          <p className="m-0 whitespace-pre-wrap break-words">
                            {path.text.slice(match.start, match.end)} → {match.text}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {path.matches.length ? (
                  <div>
                    <h3 className={formTitle}>{labels.preview}</h3>
                    <pre className="m-0 whitespace-pre-wrap break-words text-sm text-ink">{path.preview}</pre>
                  </div>
                ) : null}
                <details className="group/checks">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-ink-soft [&::-webkit-details-marker]:hidden">
                    <IoChevronForwardOutline size={14} className="shrink-0 group-open/checks:rotate-90" aria-hidden />
                    {labels.candidates} ({path.checks.length})
                  </summary>
                  <ul className="mt-2 flex list-none flex-col gap-3 p-0 pl-5">
                    {path.checks.map((check, i) => {
                      const record = trace.records[check.recordRef]
                      return (
                        <li key={`${check.recordRef}:${i}`} className="min-w-0 text-xs text-ink-soft">
                          <p className="m-0">
                            #{record.id} · r{record.revision} · {record.engine}
                          </p>
                          <pre className="m-0 whitespace-pre-wrap break-words text-ink">{record.src}</pre>
                          <pre className="m-0 whitespace-pre-wrap break-words">{record.zh}</pre>
                          <code className="whitespace-pre-wrap break-all">
                            {sentenceUnits(record.src, { newlines: record.newlines, structure: record.structure?.source })
                              .map((u) => u.key)
                              .join(' | ')}
                          </code>
                          {check.reasons.map((code) => (
                            <p key={code} className="m-0">
                              {reason(code)}
                            </p>
                          ))}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
}
