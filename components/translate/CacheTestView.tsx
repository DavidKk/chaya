'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { IoArrowBackOutline, IoChevronForwardOutline } from 'react-icons/io5'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { formCard, formDesc, formTitle } from '@/components/layoutClasses'
import { PanelHeadEnd, PanelHeadStart } from '@/components/PanelHeadEnd'
import { Badge, Button, EmptyState, PlainTextEditor, ScrollArea, Select } from '@/components/sk'
import { readApiErrorMessage } from '@/lib/api-error'
import { CACHE_TEST_MAX_LENGTH, type CacheTestResult, type CacheTestScope } from '@/lib/translate/cache-diagnostics'
import { CACHE_LANGS, type CacheLang, parseCacheLang } from '@/lib/translate/cache-lang'
import { normalizeTranslateQuery } from '@/lib/translate/cache-query'
import { joinSentenceBlock } from '@/lib/translate/sentence-plan'
import { sentenceQueryViewUnits } from '@/lib/translate/sentence-query'
import type { StructureAnnotation } from '@/lib/translate/structured-segments'
import { returnToNavigationSource } from '@/lib/ui/navigation-restoration'

import { CACHE_TEST_COPY } from './cache-test-copy'
import { CacheMatchTraceView } from './CacheMatchTraceView'
import { CopyIconButton } from './CopyIconButton'
import { cacheDebugReturnHref } from './tabs'
import { useTranslationFetch } from './TranslationRuntimeContext'

export function CacheTestView() {
  const locale = useLocaleCode(),
    t = useT(),
    copy = CACHE_TEST_COPY[locale]
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawUrlText = searchParams.get('q') || ''
  const urlText = normalizeTranslateQuery(rawUrlText)
  const send = useTranslationFetch()
  const { roomId, browserMode } = useGameLinkContext()
  const [text, setText] = useState(urlText)
  const [from, setFrom] = useState<CacheLang>(() => parseCacheLang(searchParams.get('from')) || 'ja'),
    [to, setTo] = useState<CacheLang>(() => parseCacheLang(searchParams.get('to')) || 'zh')
  const [scope, setScope] = useState<CacheTestScope>('shared')
  const [mode, setMode] = useState<'auto' | StructureAnnotation['mode']>('auto')
  const [result, setResult] = useState<CacheTestResult | null>(null)
  const [error, setError] = useState(''),
    [invalid, setInvalid] = useState(false),
    [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null),
    generation = useRef(0),
    lastSyncedUrlText = useRef(urlText),
    inputRef = useRef<HTMLDivElement>(null)
  const gameAllowed = !!roomId && !browserMode && to === 'zh'
  const normalizedText = normalizeTranslateQuery(text)
  const queryKey = JSON.stringify({ text: normalizedText, from, to, scope, mode, roomId })
  useEffect(() => {
    if (lastSyncedUrlText.current !== urlText) {
      lastSyncedUrlText.current = urlText
      setText(urlText)
    }
    if (rawUrlText && rawUrlText !== urlText) {
      const params = new URLSearchParams(searchParams.toString())
      if (urlText) params.set('q', urlText)
      else params.delete('q')
      router.replace(`/translate/test?${params.toString()}`, { scroll: false })
    }
  }, [urlText, rawUrlText, router, searchParams])
  useEffect(() => {
    generation.current++
    request.current?.abort()
    setPending(false)
    setResult(null)
    setError('')
    setInvalid(false)
  }, [queryKey])
  useEffect(
    () => () => {
      generation.current++
      request.current?.abort()
    },
    []
  )
  useEffect(() => {
    if (!gameAllowed && scope !== 'shared') setScope('shared')
  }, [gameAllowed, scope])

  async function run() {
    if (request.current && !request.current.signal.aborted) return
    const normalized = normalizeTranslateQuery(text)
    if (!normalized || normalized.length > CACHE_TEST_MAX_LENGTH) {
      setError(copy.length)
      setInvalid(true)
      inputRef.current?.querySelector('textarea')?.focus()
      return
    }
    if (normalized !== text) setText(normalized)
    const id = ++generation.current
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setPending(true)
    setResult(null)
    setError('')
    setInvalid(false)
    try {
      const params = new URLSearchParams(searchParams.toString())
      params.set('q', normalized)
      router.replace(`/translate/test?${params.toString()}`, { scroll: false })
      const response = await send('/api/translate-cache/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ text: normalized, from, to, scope, gameId: scope === 'shared' ? undefined : roomId, structure: mode === 'auto' ? undefined : { mode } }),
      })
      const body = await response.json()
      if (!response.ok || body.ok === false) throw new Error(readApiErrorMessage(body, copy.error))
      if (id === generation.current) setResult(body as CacheTestResult)
    } catch (cause) {
      if (!controller.signal.aborted && id === generation.current) setError(cause instanceof Error ? cause.message : copy.error)
    } finally {
      if (id === generation.current) {
        setPending(false)
        request.current = null
      }
    }
  }
  const langs = CACHE_LANGS.map((value) => ({
    value,
    label: t(value === 'ja' ? 'translate.cacheLangJa' : value === 'en' ? 'translate.cacheLangEn' : value === 'zh' ? 'translate.cacheLangZh' : 'translate.cacheLangKo'),
  }))
  return (
    <>
      <PanelHeadStart>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.back}
          tooltip={copy.back}
          onClick={() => returnToNavigationSource(router, cacheDebugReturnHref(searchParams.get('returnTo')))}
        >
          <IoArrowBackOutline size={16} aria-hidden />
        </Button>
      </PanelHeadStart>
      <PanelHeadEnd>
        <div className="flex flex-nowrap items-center gap-2">
          <Select className="min-w-[4.5rem]" aria-label={copy.from} tooltip={copy.from} value={from} options={langs} onChange={(value) => setFrom(value as CacheLang)} />
          <Select className="min-w-[4.5rem]" aria-label={copy.to} tooltip={copy.to} value={to} options={langs} onChange={(value) => setTo(value as CacheLang)} />
          <Select
            aria-label={copy.scope}
            tooltip={gameAllowed ? copy.scope : `${copy.scope} · ${copy.noGame}`}
            value={scope}
            onChange={(v) => setScope(v as CacheTestScope)}
            options={[
              { value: 'shared', label: copy.shared },
              { value: 'game', label: copy.game, disabled: !gameAllowed },
              { value: 'combined', label: copy.combined, disabled: !gameAllowed },
            ]}
          />
          <Button variant="accent" loading={pending} aria-label={copy.run} onClick={() => void run()}>
            {copy.run}
          </Button>
        </div>
      </PanelHeadEnd>
      <ScrollArea className="min-h-0 flex-1" reserveGutter={false} scrollProps={{ 'aria-label': copy.intro }}>
        <div className="flex min-w-0 flex-col gap-4 p-4">
          <section className={`${formCard} min-w-0`}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 border-b border-line pb-4">
                <h2 className={formTitle}>{copy.input}</h2>
                <p className={formDesc}>{copy.hint}</p>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className={formTitle}>{copy.source}</h3>
                  <div ref={inputRef} aria-invalid={invalid} aria-describedby="cache-test-error">
                    <PlainTextEditor value={text} onChange={setText} minLines={4} heightPx={180} aria-label={copy.input} />
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={formTitle}>{copy.output}</h3>
                    {result ? (
                      <span className="inline-flex flex-wrap gap-2" role="status">
                        <Badge size="mini" tone="ok">
                          {copy.matches}: {result.plan.matches.length}
                        </Badge>
                        <Badge size="mini" tone="warn">
                          {copy.gaps}: {result.plan.gaps.length}
                        </Badge>
                      </span>
                    ) : null}
                  </div>
                  <PlainTextEditor
                    value={result?.preview || ''}
                    highlights={result ? resultHighlights(result, copy.matches, copy.gaps) : undefined}
                    minLines={4}
                    heightPx={180}
                    aria-label={copy.output}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4" role="group" aria-label={copy.mode} aria-describedby="cache-test-structure-help">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h3 className={formTitle}>{copy.mode}</h3>
                  <p id="cache-test-structure-help" className={formDesc}>
                    {copy.structureHelp}
                  </p>
                  {mode === 'accept' ? <p className={formDesc}>{copy.temporary}</p> : null}
                </div>
                <Select
                  className="shrink-0"
                  aria-label={copy.mode}
                  value={mode}
                  onChange={(v) => setMode(v as typeof mode)}
                  options={[
                    { value: 'auto', label: copy.auto },
                    { value: 'accept', label: copy.accept },
                    { value: 'disabled', label: copy.disabled },
                  ]}
                />
              </div>
              <div id="cache-test-error" hidden={!error} className="text-xs text-fail" role={error ? 'alert' : 'status'}>
                {error}
              </div>
            </div>
          </section>
          {!result ? (
            <section className={formCard}>
              <EmptyState density="compact" title={copy.intro} message={copy.empty} />
            </section>
          ) : (
            <CacheTestResults result={result} />
          )}
        </div>
      </ScrollArea>
    </>
  )
}

function CacheTestResults({ result }: { result: CacheTestResult }) {
  const copy = CACHE_TEST_COPY[useLocaleCode()]
  const { plan, structure } = result
  const segments = result.segments ?? sentenceQueryViewUnits(result.query.text, { structure: result.query.structure, srcLang: result.query.from })
  return (
    <>
      <section className={formCard} aria-label={copy.structure}>
        <h2 className={formTitle}>{copy.structure}</h2>
        {structure.units.length ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {structure.units.map((u) => (
              <li key={u.id} className="flex flex-wrap gap-2 text-sm">
                <Badge tone={u.state === 'accepted' ? 'info' : 'warn'}>{u.state === 'accepted' ? copy.accepted : copy.suggested}</Badge>
                <span className="whitespace-pre-wrap break-words">{result.query.text.slice(u.start, u.end)}</span>
              </li>
            ))}
          </ol>
        ) : segments.length ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {segments.map((unit, i) => (
              <li key={`${unit.start}:${unit.end}`} className="flex min-w-0 flex-wrap items-start gap-2 text-sm">
                <Badge tone="info">{segments.length > 1 ? `${copy.sentenceSegment} ${i + 1}` : copy.wholeSegment}</Badge>
                <span className="min-w-0 whitespace-pre-wrap break-words">{result.query.text.slice(unit.start, unit.end)}</span>
                <span className="text-xs text-ink-soft">
                  [{unit.start}, {unit.end})
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState density="compact" title={copy.structureEmpty} />
        )}
      </section>
      {result.trace ? <CacheMatchTraceView trace={result.trace} /> : null}
      <section className={formCard} aria-label={copy.matches}>
        <div className="flex flex-col gap-1">
          <h2 className={formTitle}>{copy.matches}</h2>
          <p className={formDesc}>
            {copy.candidates}: {result.candidateCount} · {copy.rule}: {result.ruleVersion}
          </p>
        </div>
        {!plan.matches.length ? (
          <EmptyState density="compact" title={copy.miss} message={copy.none} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {plan.matches.map((m) => (
              <li key={`${m.start}:${m.end}`} className="flex min-w-0 flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <Badge tone="info" className="bg-info/20">
                    {m.record.local ? copy.local : copy.remote}
                  </Badge>
                  <span>
                    {m.record.engine} · {m.kind}
                  </span>
                  <span>
                    #{m.record.id} · r{m.record.revision}
                  </span>
                </div>
                <p className="m-0 whitespace-pre-wrap break-words text-sm text-ink">
                  {result.query.text.slice(m.start, m.end)} → {m.text}
                </p>
                <details className="group text-xs text-ink-soft">
                  <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <IoChevronForwardOutline size={16} className="shrink-0 group-open:rotate-90" aria-hidden />
                    {copy.record}
                  </summary>
                  <div className="mt-2 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
                    <div className="col-start-2 flex min-w-0 flex-col gap-2">
                      <div className="group/cell relative">
                        <div className="absolute top-0 right-0 z-10">
                          <CopyIconButton text={m.record.src} />
                        </div>
                        <pre className="m-0 whitespace-pre-wrap break-words pr-6">{m.record.src}</pre>
                      </div>
                      <span>{copy.translation}</span>
                      <div className="group/cell relative">
                        <div className="absolute top-0 right-0 z-10">
                          <CopyIconButton text={m.record.zh} />
                        </div>
                        <pre className="m-0 whitespace-pre-wrap break-words pr-6">{m.record.zh}</pre>
                      </div>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        {result.diagnostics.length ? (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <h3 className={formTitle}>{copy.diagnostics}</h3>
            {[...new Set(result.diagnostics)].map((d) => (
              <p key={d} className="m-0 text-xs text-warn">
                {copy.reasons[d] || d}
              </p>
            ))}
          </div>
        ) : null}
      </section>
    </>
  )
}

/** Translate source offsets into the assembled output's offsets, including preserved seams. */
function resultHighlights(result: CacheTestResult, hitLabel: string, missLabel: string) {
  const { plan } = result
  const pieces = [
    ...plan.matches.map((match) => ({
      start: match.start,
      end: match.end,
      text: match.text,
      hit: true,
      trim: /[,，、;；]\s*$/.test(match.record.src.slice(match.sourceStart, match.sourceEnd)),
    })),
    ...plan.gaps.map((gap) => ({ ...gap, hit: false, trim: false })),
  ].sort((a, b) => a.start - b.start)
  let sourceOffset = 0,
    outputOffset = 0
  return pieces.map((piece) => {
    outputOffset += plan.src.slice(sourceOffset, piece.start).length
    const start = outputOffset
    outputOffset += (piece.hit ? joinSentenceBlock(plan.src.slice(piece.start, piece.end), piece.text, piece.trim) : piece.text).length
    sourceOffset = piece.end
    return { start, end: outputOffset, tone: piece.hit ? ('ok' as const) : ('warn' as const), label: piece.hit ? hitLabel : missLabel }
  })
}
