'use client'

import { Menu } from '@base-ui/react/menu'
import { useMemo, useState } from 'react'
import { IoAddOutline, IoCheckmark, IoChevronBackOutline, IoChevronDown, IoTrashOutline } from 'react-icons/io5'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { formCard, formDesc, formTitle } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { PanelHeadStart } from '@/components/PanelHeadEnd'
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  pairedPlainTextHeightPx,
  PLAIN_TEXT_EDITOR_LINE_H,
  PLAIN_TEXT_EDITOR_MIN_LINES,
  PlainTextEditor,
  PlainTextEditorFrame,
  ScrollArea,
} from '@/components/sk'
import { Select } from '@/components/sk'
import { controlDisabled } from '@/components/sk/control'
import { dropdownItemClass, dropdownPopupClass } from '@/components/sk/dropdownMenu'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import type { MessageKey } from '@/lib/i18n'
import { type CacheLang, DEFAULT_CACHE_SRC_LANG, DEFAULT_CACHE_TGT_LANG } from '@/lib/translate/cache-lang'
import { listNewlineSpans, type NewlineAnnotation, type NewlineKind } from '@/lib/translate/logic-text'
import { buildOptimizeSegmentPairs, hasOptimizeCandidates, type OptimizeSegmentPair } from '@/lib/translate/optimize-segments'
import { type RecordStructure, scanStructuredText } from '@/lib/translate/structured-segments'
import { cn } from '@/lib/utils'

import { CACHE_TEST_COPY } from './cache-test-copy'

/** Top edit card: slightly under half-viewport; long text scrolls inside. */
const EDIT_PANE_MAX_PX = 280
const EDITOR_MIN_LINES = PLAIN_TEXT_EDITOR_MIN_LINES

export type CacheOptimizeTarget = {
  id?: number
  revision?: number
  structure?: RecordStructure
  src: string
  zh: string
  from?: CacheLang
  to?: CacheLang
}

type Props = {
  target: CacheOptimizeTarget
  onBack: () => void
  onConfirmed?: () => void
}

const KIND_VALUES: NewlineKind[] = ['soft', 'hard', 'unknown']

const LANG_KEY: Record<CacheLang, MessageKey> = {
  ja: 'translate.cacheLangJa',
  en: 'translate.cacheLangEn',
  zh: 'translate.cacheLangZh',
  ko: 'translate.cacheLangKo',
  ru: 'translate.cacheLangRu',
}

const paneHeadClass = 'mb-2 shrink-0 text-[0.68rem] font-semibold uppercase tracking-[0.05em]'
/** Bordered editors sit inside padded panes; left/right heights paired. */
const srcPaneClass = 'flex min-w-0 flex-col bg-paper px-4 py-4'
const zhPaneClass = 'flex min-w-0 flex-col border-l border-line bg-[color-mix(in_oklab,var(--accent)_9%,var(--panel))] px-4 py-4'

const BREAK_TONE: Record<NewlineKind, BadgeTone> = {
  soft: 'info',
  hard: 'warn',
  unknown: 'neutral',
}

function BreakKindMenu({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: NewlineKind
  options: Array<{ value: NewlineKind; label: string }>
  disabled?: boolean
  ariaLabel: string
  onChange: (kind: NewlineKind) => void
}) {
  const current = options.find((o) => o.value === value)?.label ?? value
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} aria-label={ariaLabel} className={cn('inline-flex shrink-0 cursor-pointer border-0 bg-transparent p-0', controlDisabled)}>
        <Badge tone={BREAK_TONE[value]} dot={false} className="pointer-events-auto gap-0.5 pr-1.5">
          {current}
          <IoChevronDown size={10} aria-hidden className="opacity-70" />
        </Badge>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} positionMethod="fixed" className="z-[70]">
          <Menu.Popup aria-label={ariaLabel} className={cn(dropdownPopupClass, 'min-w-[7.5rem]')}>
            <Menu.RadioGroup
              value={value}
              onValueChange={(next: unknown) => {
                if (next === 'soft' || next === 'hard' || next === 'unknown') onChange(next)
              }}
            >
              {options.map((opt) => (
                <Menu.RadioItem key={opt.value} value={opt.value} closeOnClick className={dropdownItemClass}>
                  <Badge tone={BREAK_TONE[opt.value]} dot={false}>
                    {opt.label}
                  </Badge>
                  <Menu.RadioItemIndicator keepMounted className="inline-flex shrink-0 data-[unchecked]:invisible">
                    <IoCheckmark size={14} aria-hidden />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function PairRow({
  src,
  zh,
  disabled,
  onSrc,
  onZh,
  onRemove,
}: {
  src: string
  zh: string
  disabled?: boolean
  onSrc: (v: string) => void
  onZh: (v: string) => void
  onRemove?: () => void
}) {
  const t = useT()
  const heightPx = pairedPlainTextHeightPx(src, zh, { minLines: EDITOR_MIN_LINES })
  return (
    <div className={cn('grid items-stretch gap-2', onRemove ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-2')}>
      <PlainTextEditor value={src} disabled={disabled} softWrap={false} minLines={EDITOR_MIN_LINES} heightPx={heightPx} aria-label={t('translate.cacheSrc')} onChange={onSrc} />
      <PlainTextEditor value={zh} disabled={disabled} softWrap minLines={EDITOR_MIN_LINES} heightPx={heightPx} aria-label={t('translate.cacheZh')} onChange={onZh} />
      {onRemove ? (
        <Button variant="plain" size="mini" disabled={disabled} aria-label={t('common.remove')} onClick={onRemove}>
          <IoTrashOutline size={14} aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

/** Source editor chrome with inline break-kind badges (same shell as PlainTextEditor). */
function SourceBreakEditor({
  src,
  breaks,
  breakKinds,
  kindOptions,
  disabled,
  heightPx,
  onKind,
}: {
  src: string
  breaks: ReturnType<typeof listNewlineSpans>
  breakKinds: Record<string, NewlineKind>
  kindOptions: Array<{ value: NewlineKind; label: string }>
  disabled?: boolean
  heightPx: number
  onKind: (key: string, kind: NewlineKind) => void
}) {
  const t = useT()
  const rows = useMemo(() => {
    const out: Array<{ text: string; break?: (typeof breaks)[number] }> = []
    let at = 0
    for (const span of breaks) {
      out.push({ text: src.slice(at, span.start), break: span })
      at = span.end
    }
    out.push({ text: src.slice(at) })
    return out
  }, [breaks, src])

  return (
    <PlainTextEditorFrame lineCount={rows.length} minLines={EDITOR_MIN_LINES} heightPx={heightPx} className={cn(disabled && 'opacity-45')} aria-label={t('translate.cacheSrc')}>
      {rows.map((row, index) => {
        const span = row.break
        const key = span ? `${span.start}:${span.end}` : `tail:${index}`
        const kind = span ? (breakKinds[key] ?? span.kind) : undefined
        return (
          <div key={key} className="flex w-max min-w-full items-center gap-1.5" style={{ height: PLAIN_TEXT_EDITOR_LINE_H }}>
            <div className="whitespace-pre text-[0.8125rem] text-ink" style={{ lineHeight: `${PLAIN_TEXT_EDITOR_LINE_H}px` }}>
              {row.text || '\u00a0'}
            </div>
            {span && kind ? (
              <BreakKindMenu
                value={kind}
                options={kindOptions}
                disabled={disabled}
                ariaLabel={breaks.length > 1 ? `${t('translate.cacheOptimizeBreaks')} ${index + 1}` : t('translate.cacheOptimizeBreaks')}
                onChange={(next) => onKind(key, next)}
              />
            ) : null}
          </div>
        )
      })}
    </PlainTextEditorFrame>
  )
}

export function CacheOptimizeContent({ target, onBack, onConfirmed }: Props) {
  const t = useT()
  const copy = CACHE_TEST_COPY[useLocaleCode()]
  const [structure, setStructure] = useState<RecordStructure | undefined>(target.structure)
  const [structureDirty, setStructureDirty] = useState(false)
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const derived = useMemo(() => hasOptimizeCandidates(target.src, target.zh), [target.src, target.zh])
  const built = useMemo(() => buildOptimizeSegmentPairs(target.src, target.zh, structure), [target.src, target.zh, structure])
  const initialPairs = useMemo(() => (derived ? built.pairs : []), [built.pairs, derived])

  const origSrc = target.src
  const [origZh, setOrigZh] = useState(target.zh)
  const [pairs, setPairs] = useState<OptimizeSegmentPair[]>(() => initialPairs.map((p) => ({ ...p })))
  const [breakKinds, setBreakKinds] = useState<Record<string, NewlineKind>>({})
  const [saving, setSaving] = useState(false)

  const breaks = useMemo(() => listNewlineSpans(origSrc), [origSrc])
  const aligned = !derived || built.aligned
  const allFilled = pairs.every((p) => p.src.trim() && p.zh.trim())
  const kindOptions = useMemo(
    () =>
      KIND_VALUES.map((kind) => ({
        value: kind,
        label: kind === 'soft' ? t('translate.cacheOptimizeBreakSoft') : kind === 'hard' ? t('translate.cacheOptimizeBreakHard') : t('translate.cacheOptimizeBreakUnknown'),
      })),
    [t]
  )
  const markedNewlines = useMemo(() => {
    const out: NewlineAnnotation[] = []
    for (const span of breaks) {
      const kind = breakKinds[`${span.start}:${span.end}`] ?? span.kind
      if (kind === 'soft' || kind === 'hard') out.push({ start: span.start, end: span.end, kind })
    }
    return out
  }, [breaks, breakKinds])
  function changeStructure(side: 'source' | 'target', mode: string) {
    const next = { ...structure, [side]: mode === 'auto' ? undefined : { mode: mode as 'accept' | 'disabled' } }
    setStructure(next)
    setStructureDirty(true)
    setPairs(next.source?.mode === 'disabled' || next.target?.mode === 'disabled' ? [] : buildOptimizeSegmentPairs(origSrc, origZh, next).pairs)
  }
  const canConfirm = Boolean(origSrc.trim() && origZh.trim()) && allFilled && !saving
  const srcLang = target.from || DEFAULT_CACHE_SRC_LANG
  const tgtLang = target.to || DEFAULT_CACHE_TGT_LANG

  function updatePair(index: number, patch: Partial<OptimizeSegmentPair>) {
    setPairs((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function removePair(index: number) {
    setPairs((prev) => prev.filter((_, i) => i !== index))
  }

  function addPair() {
    setPairs((prev) => [...prev, { src: '', zh: '' }])
  }

  function setBreakKind(key: string, kind: NewlineKind) {
    setBreakKinds((prev) => ({ ...prev, [key]: kind }))
  }

  async function confirmWrite() {
    const ready = pairs.map((p) => ({ src: p.src.trim(), zh: p.zh.trim() })).filter((p) => p.src && p.zh)
    const zh = origZh.trim()
    if (!origSrc.trim() || !zh) {
      notify.error(t('translate.cacheOptimizeEmpty'))
      return
    }
    setSaving(true)
    try {
      if (zh !== String(target.zh).trim()) {
        const patchRes = await translationFetch('/api/translate-cache', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ src: target.src, zh, from: target.from, to: target.to }),
        })
        const patchJson = (await patchRes.json()) as { ok?: boolean; error?: string; message?: string }
        if (!patchRes.ok || patchJson.ok === false) {
          notify.error(readApiErrorMessage(patchJson, t('translate.cacheOptimizeFailed')))
          return
        }
      }

      if (!ready.length && !markedNewlines.length && !structure) {
        notify.success(t('translate.cacheZhUpdated'))
        onConfirmed?.()
        onBack()
        return
      }

      const body = {
        pairs: ready,
        parent: { src: target.src, zh: zh !== String(target.zh).trim() ? zh : target.zh },
        structure,
        replaceGroups: structureDirty,
        expectedRevision: zh !== String(target.zh).trim() ? undefined : target.revision,
        from: target.from,
        to: target.to,
        newlines: markedNewlines,
      }

      const pre = await translationFetch('/api/translate-cache/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, dryRun: true }),
      })
      const preJson = (await pre.json()) as { ok?: boolean; stale?: boolean; conflict?: number; error?: string; message?: string }
      if (!pre.ok || preJson.ok === false) {
        notify.error(readApiErrorMessage(preJson, t('translate.cacheOptimizePrecheckFail')))
        return
      }
      if ((preJson.conflict ?? 0) > 0 && ready.length) {
        notify.error(t('translate.cacheOptimizePrecheckFail'))
        return
      }

      const res = await translationFetch('/api/translate-cache/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as {
        ok?: boolean
        inserted?: number
        upserted?: number
        identical?: number
        conflict?: number
        game?: number
        error?: string
        message?: string
      }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.cacheOptimizeFailed')))
        return
      }
      const inserted = json.inserted ?? json.upserted ?? 0
      const identical = json.identical ?? 0
      const conflict = json.conflict ?? 0
      const game = json.game ?? 0
      notify.success(
        t('translate.cacheOptimizeDoneDetail', {
          inserted: String(inserted),
          identical: String(identical),
          conflict: String(conflict),
          game: String(game),
        })
      )
      onConfirmed?.()
      onBack()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.cacheOptimizeFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeadStart>
        <Button variant="ghost" size="icon" disabled={saving} aria-label={t('translate.cacheOptimizeBack')} onClick={onBack}>
          <IoChevronBackOutline size={16} aria-hidden />
        </Button>
      </PanelHeadStart>

      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('translate.cacheOptimizeListAria') }}>
        {/* 横向满宽；编辑区约半屏高，过长在卡内滚，不必占满整屏 */}
        <div className="flex w-full flex-col gap-4 p-4">
          <section className={formCard} aria-label={t('translate.cacheDetailEditTitle')}>
            <div className="flex flex-col gap-1">
              <span className={formTitle}>{t('translate.cacheDetailEditTitle')}</span>
              <span className={formDesc}>{target.id != null ? t('translate.cacheDetailEditDesc', { id: String(target.id) }) : t('translate.cacheDetailEditDescPlain')}</span>
            </div>
            <div className="!px-0 !py-0">
              <div className="grid grid-cols-2 items-stretch">
                <div className={srcPaneClass}>
                  <div className={cn(paneHeadClass, 'text-ink-soft')}>
                    {t('translate.cacheSrc')} · {t(LANG_KEY[srcLang])}
                  </div>
                  <SourceBreakEditor
                    src={origSrc}
                    breaks={breaks}
                    breakKinds={breakKinds}
                    kindOptions={kindOptions}
                    disabled={saving}
                    heightPx={pairedPlainTextHeightPx(origSrc, origZh, { minLines: EDITOR_MIN_LINES, maxPx: EDIT_PANE_MAX_PX })}
                    onKind={setBreakKind}
                  />
                </div>
                <div className={zhPaneClass}>
                  <div className={cn(paneHeadClass, 'text-accent')}>
                    {t('translate.cacheZh')} · {t(LANG_KEY[tgtLang])}
                  </div>
                  <PlainTextEditor
                    value={origZh}
                    disabled={saving}
                    softWrap
                    minLines={EDITOR_MIN_LINES}
                    heightPx={pairedPlainTextHeightPx(origSrc, origZh, { minLines: EDITOR_MIN_LINES, maxPx: EDIT_PANE_MAX_PX })}
                    className="border-accent bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]"
                    aria-label={`${t('translate.cacheZh')} · ${t(LANG_KEY[tgtLang])}`}
                    onChange={setOrigZh}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className={formCard} aria-label={copy.structure}>
            <span className={formTitle}>{copy.structure}</span>
            <span className={formDesc}>{copy.boundaryHelp}</span>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['source', 'target'] as const).map((side) => (
                <div key={side} className="flex flex-col gap-2">
                  <span className={formTitle}>{side === 'source' ? copy.sourceStructure : copy.targetStructure}</span>
                  <Select
                    aria-label={side === 'source' ? copy.sourceStructure : copy.targetStructure}
                    disabled={saving}
                    value={structure?.[side]?.mode || 'auto'}
                    onChange={(mode) => changeStructure(side, mode)}
                    options={[
                      { value: 'auto', label: copy.auto },
                      { value: 'accept', label: copy.accept },
                      { value: 'disabled', label: copy.disabled },
                    ]}
                  />
                  <ul className="m-0 list-none p-0 text-xs text-ink-soft">
                    {scanStructuredText(side === 'source' ? origSrc : origZh, structure?.[side]).units.map((u) => (
                      <li key={u.id} className="whitespace-pre-wrap break-words">
                        {u.state === 'suggested' ? copy.suggested : copy.accepted} · {(side === 'source' ? origSrc : origZh).slice(u.start, u.end)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
          <section className={formCard} aria-label={t('translate.cacheOptimize')}>
            <div className="flex items-start gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={formTitle}>{t('translate.cacheOptimize')}</span>
                <span className={formDesc}>{t('translate.cacheOptimizeCardDesc')}</span>
                {derived && (!aligned || !allFilled) ? <p className="m-0 text-[0.7rem] text-warn">{t('translate.cacheOptimizeMismatch')}</p> : null}
              </div>
              <Button variant="accent" size="icon" className="shrink-0" disabled={saving} aria-label={t('translate.cacheOptimizeAdd')} onClick={addPair}>
                <IoAddOutline size={16} aria-hidden />
              </Button>
            </div>
            {pairs.length === 0 ? (
              <EmptyState density="compact" title={t('translate.cacheOptimizeNoSplitTitle')} message={t('translate.cacheOptimizeNoSplitMsg')} />
            ) : (
              <div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {pairs.map((pair, index) => (
                    <li key={index}>
                      <PairRow
                        src={pair.src}
                        zh={pair.zh}
                        disabled={saving}
                        onSrc={(v) => updatePair(index, { src: v })}
                        onZh={(v) => updatePair(index, { zh: v })}
                        onRemove={() => removePair(index)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="accent" loading={saving} disabled={!canConfirm} onClick={() => void confirmWrite()}>
                {t('translate.cacheOptimizeConfirm')}
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
