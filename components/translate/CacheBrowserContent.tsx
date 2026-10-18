'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline, IoTrashOutline } from 'react-icons/io5'
import { LiaExchangeAltSolid } from 'react-icons/lia'
import { TbBug, TbPencil, TbRating18Plus } from 'react-icons/tb'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell, panelFoot } from '@/components/layoutClasses'
import { useNavigationViewState } from '@/components/navigation/useNavigationViewState'
import { useNotification } from '@/components/notification/useNotification'
import { PanelHeadEnd } from '@/components/PanelHeadEnd'
import { Badge, Button, EmptyState, ScrollArea, Select, SortableTh, TextInput, TruncateText } from '@/components/sk'
import { CACHE_TEST_COPY } from '@/components/translate/cache-test-copy'
import { CacheOptimizeContent, type CacheOptimizeTarget } from '@/components/translate/CacheOptimizeContent'
import { CopyIconButton } from '@/components/translate/CopyIconButton'
import {
  TRANSLATE_CACHE_COLUMN_WIDTHS,
  TRANSLATE_CACHE_GRID_MIN_WIDTH,
  translateCacheGridTemplate,
  TranslateCacheTableSkeleton,
} from '@/components/translate/TranslateCacheTableSkeleton'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import { LOCALE_HTML_LANG, type MessageKey } from '@/lib/i18n'
import {
  CACHE_ENGINE_KINDS,
  CACHE_LIVE_FLAGS,
  CACHE_NSFW_FLAGS,
  type CacheEngineKind,
  cacheEngineKind,
  type CacheLiveFlag,
  type CacheNsfwFlag,
  isLiveCacheEngine,
  parseCacheLiveFlag,
  parseCacheNsfwFlag,
} from '@/lib/translate/cache-engine-kind'
import { CACHE_LANG_CODE, formatCacheHitCount, formatCacheUpdatedAt } from '@/lib/translate/cache-format'
import { CACHE_LANGS, type CacheLang, parseCacheLang } from '@/lib/translate/cache-lang'
import { parseSharedCacheSortDir, parseSharedCacheSortKey, type SharedCacheSortDir, type SharedCacheSortKey } from '@/lib/translate/cache-query'
import { cycleThreeStateSort } from '@/lib/ui/three-state-sort'
import { parsePositiveInt, patchSearchParams } from '@/lib/url/search-params'
import { cn } from '@/lib/utils'

const CACHE_NSFW_FLAG_KEY: Record<CacheNsfwFlag, MessageKey> = {
  nsfw: 'translate.cacheFlagNsfw',
  safe: 'translate.cacheFlagSafe',
}

const CACHE_LIVE_FLAG_KEY: Record<CacheLiveFlag, MessageKey> = {
  live: 'translate.cacheFlagLive',
  stored: 'translate.cacheFlagStored',
}

const CACHE_ENGINE_KIND_KEY: Record<CacheEngineKind, MessageKey> = {
  import: 'translate.cacheKindImport',
  agent: 'translate.cacheKindAgent',
  google: 'translate.cacheKindGoogle',
  bing: 'translate.cacheKindBing',
  apple: 'translate.cacheKindApple',
}

const CACHE_LANG_KEY: Record<CacheLang, MessageKey> = {
  ja: 'translate.cacheLangJa',
  en: 'translate.cacheLangEn',
  zh: 'translate.cacheLangZh',
  ko: 'translate.cacheLangKo',
  ru: 'translate.cacheLangRu',
}

function cacheEngineLabel(engine: string | null, label: (key: MessageKey) => string): string {
  const kind = cacheEngineKind(engine)
  return kind ? label(CACHE_ENGINE_KIND_KEY[kind]) : engine || '—'
}

function cacheLangLabel(lang: CacheLang, label: (key: MessageKey) => string): string {
  return label(CACHE_LANG_KEY[lang])
}

function cacheLangCode(lang: CacheLang): string {
  return CACHE_LANG_CODE[lang]
}

type CacheItem = {
  id?: number
  src: string
  zh: string
  from?: CacheLang
  to?: CacheLang
  engine: string | null
  updatedAt: number
  hitCount: number
  nsfw?: boolean
}

type CachePage = {
  ok: boolean
  page: number
  pageSize: number
  total: number
  totalPages: number
  q: string
  engine?: string
  nsfw?: boolean
  sort?: SharedCacheSortKey
  order?: SharedCacheSortDir
  engines?: string[]
  items: CacheItem[]
  file?: string
  error?: string
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]
const DEFAULT_SORT: SharedCacheSortKey = 'updated'
const DEFAULT_ORDER: SharedCacheSortDir = 'desc'

/** 固定列宽，避免翻页时随内容长短抖动 */
const CACHE_COLUMN_DEFS: {
  key: SharedCacheSortKey | 'ops' | 'pair' | 'src' | 'zh' | 'engine'
  labelKey: 'translate.cachePair' | 'translate.cacheSrc' | 'translate.cacheZh' | 'translate.cacheEngine' | 'translate.cacheHits' | 'translate.cacheUpdated' | 'translate.cacheOps'
  width: string
  align?: 'left' | 'right'
  sortKey?: SharedCacheSortKey
}[] = [
  { key: 'src', labelKey: 'translate.cacheSrc', width: TRANSLATE_CACHE_COLUMN_WIDTHS.src },
  { key: 'zh', labelKey: 'translate.cacheZh', width: TRANSLATE_CACHE_COLUMN_WIDTHS.zh },
  { key: 'pair', labelKey: 'translate.cachePair', width: TRANSLATE_CACHE_COLUMN_WIDTHS.pair },
  { key: 'engine', labelKey: 'translate.cacheEngine', width: TRANSLATE_CACHE_COLUMN_WIDTHS.engine },
  { key: 'hits', labelKey: 'translate.cacheHits', width: TRANSLATE_CACHE_COLUMN_WIDTHS.hits, sortKey: 'hits' },
  { key: 'updated', labelKey: 'translate.cacheUpdated', width: TRANSLATE_CACHE_COLUMN_WIDTHS.updated, sortKey: 'updated' },
  { key: 'ops', labelKey: 'translate.cacheOps', width: TRANSLATE_CACHE_COLUMN_WIDTHS.ops, align: 'right' },
]

function snapPageSize(n: number) {
  if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n
  return DEFAULT_PAGE_SIZE
}

function fmtTimeFull(ts: number, locale: string) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(locale, { hour12: false })
}

const cellClamp3 = 'line-clamp-3 break-words whitespace-pre-line leading-snug'

type QueryState = {
  onOpenDebug?: (query: URLSearchParams) => void
  searchParams: Pick<URLSearchParams, 'get' | 'has' | 'toString'>
  replaceQuery: (patch: Record<string, string | null | undefined>) => void
  /** Web navigates to `/translate/cache/detail/{id}`; overlay opens an in-panel subview. */
  onOpenDetail?: (row: CacheOptimizeTarget & { id?: number }) => void
}

/** 局内查询只改本地状态；Web 页由路由传 URL 参数，表格逻辑完全共用。 */
export function CacheBrowserOverlay() {
  const [searchParams, setSearchParams] = useState(() => new URLSearchParams())
  const [detail, setDetail] = useState<CacheOptimizeTarget | null>(null)
  const replaceQuery = useCallback((patch: Record<string, string | null | undefined>) => {
    setSearchParams((current) => new URLSearchParams(patchSearchParams(current, patch)))
  }, [])
  if (detail) {
    return <CacheOptimizeContent target={detail} onBack={() => setDetail(null)} onConfirmed={() => setDetail(null)} />
  }
  return <CacheBrowserContent searchParams={searchParams} replaceQuery={replaceQuery} onOpenDetail={setDetail} />
}

/** 本作翻译库内容（外壳 / 二级 tabs 由宿主提供） */
export function CacheBrowserContent({ searchParams, replaceQuery, onOpenDetail, onOpenDebug }: QueryState) {
  const t = useT()
  const locale = useLocaleCode()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const confirm = useConfirm()
  const cacheGridStyle = useMemo(() => ({ gridTemplateColumns: translateCacheGridTemplate() }), [])
  const page = parsePositiveInt(searchParams.get('page'), 1)
  const pageSize = snapPageSize(parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 200))
  const q = searchParams.get('q') ?? ''
  const engine = searchParams.get('engine') ?? ''
  const nsfwFlag = parseCacheNsfwFlag(searchParams.get('nsfw'))
  const live = parseCacheLiveFlag(searchParams.get('live'))
  const srcLang = parseCacheLang(searchParams.get('from'))
  const tgtLang = parseCacheLang(searchParams.get('to'))
  /** URL 显式带了 sort/order = 用户选过；否则为还原态（默认按更新降序，表头不点亮） */
  const sortExplicit = searchParams.has('sort') || searchParams.has('order')
  const sort = parseSharedCacheSortKey(searchParams.get('sort'), DEFAULT_SORT)
  const order = parseSharedCacheSortDir(searchParams.get('order'), DEFAULT_ORDER)
  const [qInput, setQInput] = useNavigationViewState<string>(`cache:search-draft:${q}`, q)
  const [data, setData] = useState<CachePage | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (opts: {
      page: number
      pageSize: number
      q: string
      engine: string
      nsfwFlag: CacheNsfwFlag | ''
      live: CacheLiveFlag | ''
      srcLang: CacheLang | ''
      tgtLang: CacheLang | ''
      sort: SharedCacheSortKey
      order: SharedCacheSortDir
    }) => {
      const params = new URLSearchParams({
        page: String(opts.page),
        pageSize: String(opts.pageSize),
        sort: opts.sort,
        order: opts.order,
      })
      if (opts.q) params.set('q', opts.q)
      if (opts.engine) params.set('engine', opts.engine)
      if (opts.nsfwFlag) params.set('nsfw', opts.nsfwFlag)
      if (opts.live) params.set('live', opts.live)
      if (opts.srcLang) params.set('from', opts.srcLang)
      if (opts.tgtLang) params.set('to', opts.tgtLang)
      try {
        const res = await translationFetch(`/api/translate-cache?${params}`)
        const json = (await res.json()) as CachePage
        if (!res.ok || json.ok === false) {
          setError(readApiErrorMessage(json, t('notify.loadFailed')))
          return
        }
        setError('')
        setData(json)
      } catch (error) {
        setError(error instanceof Error ? error.message : t('translate.cacheLoadFailed'))
      }
    },
    [t, translationFetch]
  )

  useEffect(() => {
    startTransition(async () => {
      await load({ page, pageSize, q, engine, nsfwFlag, live, srcLang, tgtLang, sort, order })
    })
  }, [load, page, pageSize, q, engine, nsfwFlag, live, srcLang, tgtLang, sort, order])

  function setFilters(patch: {
    page?: number
    pageSize?: number
    q?: string
    engine?: string
    nsfwFlag?: CacheNsfwFlag | ''
    live?: CacheLiveFlag | ''
    srcLang?: CacheLang | ''
    tgtLang?: CacheLang | ''
    sort?: SharedCacheSortKey
    order?: SharedCacheSortDir
    /** true：写入显式排序；false：还原默认并清掉 URL 排序参数 */
    sortExplicit?: boolean
  }) {
    const nextPage = patch.page ?? page
    const nextSize = patch.pageSize ?? pageSize
    const nextQ = patch.q ?? q
    const nextEngine = patch.engine ?? engine
    const nextNsfw = patch.nsfwFlag ?? nsfwFlag
    const nextLive = patch.live ?? live
    const nextSrcLang = patch.srcLang ?? srcLang
    const nextTgtLang = patch.tgtLang ?? tgtLang
    const nextExplicit = patch.sortExplicit ?? sortExplicit
    const nextSort = patch.sort ?? sort
    const nextOrder = patch.order ?? order
    replaceQuery({
      page: nextPage <= 1 ? null : String(nextPage),
      pageSize: nextSize === DEFAULT_PAGE_SIZE ? null : String(nextSize),
      q: nextQ || null,
      engine: nextEngine || null,
      nsfw: nextNsfw || null,
      live: nextLive || null,
      from: nextSrcLang || null,
      to: nextTgtLang || null,
      sort: nextExplicit ? nextSort : null,
      order: nextExplicit ? nextOrder : null,
    })
  }

  function commitQ(next: string) {
    const trimmed = next.trim()
    if (trimmed === q) {
      if (next !== trimmed) setQInput(trimmed)
      return
    }
    setQInput(trimmed)
    setFilters({ page: 1, q: trimmed })
  }

  function toggleSort(next: SharedCacheSortKey) {
    const cycled = cycleThreeStateSort(next, { key: sort, order, explicit: sortExplicit }, { key: DEFAULT_SORT, order: DEFAULT_ORDER })
    setFilters({ page: 1, sort: cycled.key, order: cycled.order, sortExplicit: cycled.explicit })
  }

  function go(nextPage: number) {
    const p = Math.max(1, Math.min(data?.totalPages || 1, nextPage))
    setFilters({ page: p })
  }

  function reload() {
    startTransition(async () => {
      await load({ page, pageSize, q, engine, nsfwFlag, live, srcLang, tgtLang, sort, order })
    })
  }

  async function askToggleNsfw(row: CacheItem) {
    if (busy) return
    const next = !row.nsfw
    const ok = await confirm({
      title: next ? t('translate.cacheMarkNsfwTitle') : t('translate.cacheClearNsfwTitle'),
      description: next ? t('translate.cacheMarkNsfwDesc') : t('translate.cacheClearNsfwDesc'),
      confirmLabel: next ? t('translate.cacheMarkNsfw') : t('translate.cacheClearNsfw'),
      onConfirm: async () => {
        setSaving(true)
        try {
          const res = await translationFetch('/api/translate-cache', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ src: row.src, from: row.from, to: row.to, nsfw: next }),
          })
          const json = (await res.json()) as { ok?: boolean; error?: string; message?: string }
          if (!res.ok || json.ok === false) {
            const msg = readApiErrorMessage(json, t('notify.saveFailed'))
            notify.error(msg)
            throw new Error(msg)
          }
        } finally {
          setSaving(false)
        }
      },
    })
    if (ok) {
      notify.success(t('translate.cacheNsfwUpdated'))
      reload()
    }
  }

  async function askDelete(row: CacheItem) {
    const ok = await confirm({
      title: t('translate.cacheDeleteTitle'),
      description: t('translate.cacheDeleteDesc'),
      confirmLabel: t('common.remove'),
      confirmVariant: 'fail',
      onConfirm: async () => {
        const res = await translationFetch('/api/translate-cache', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ src: row.src, from: row.from, to: row.to }),
        })
        const json = (await res.json()) as { ok?: boolean; error?: string; message?: string }
        if (!res.ok || json.ok === false) {
          const msg = readApiErrorMessage(json, t('translate.cacheDeleteFailed'))
          notify.error(msg)
          throw new Error(msg)
        }
      },
    })
    if (ok) {
      notify.success(t('translate.cacheDeleted'))
      reload()
    }
  }

  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1
  const visiblePage = data?.page ?? page
  const rangeFrom = total === 0 ? 0 : (visiblePage - 1) * pageSize + 1
  const rangeTo = Math.min(visiblePage * pageSize, total)
  const loading = pending && !data
  const empty = Boolean(data && data.items.length === 0)
  const busy = pending || saving
  const engineOptions = [{ value: '', label: t('translate.cacheAllEngines') }, ...CACHE_ENGINE_KINDS.map((value) => ({ value, label: t(CACHE_ENGINE_KIND_KEY[value]) }))]
  const nsfwOptions = [{ value: '', label: t('translate.cacheFlagAll') }, ...CACHE_NSFW_FLAGS.map((value) => ({ value, label: t(CACHE_NSFW_FLAG_KEY[value]) }))]
  const liveOptions = [{ value: '', label: t('translate.cacheFlagAll') }, ...CACHE_LIVE_FLAGS.map((value) => ({ value, label: t(CACHE_LIVE_FLAG_KEY[value]) }))]
  const langOptions = [{ value: '', label: t('translate.cacheFlagAll') }, ...CACHE_LANGS.map((value) => ({ value, label: t(CACHE_LANG_KEY[value]) }))]
  const hasFilter = Boolean(q || engine || nsfwFlag || live || srcLang || tgtLang)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeadEnd>
        <ScrollArea
          indicator="horizontal"
          reserveGutter={false}
          className="h-8 min-w-0 flex-1"
          scrollClassName="flex items-center"
          scrollProps={{ tabIndex: 0, 'aria-label': t('translate.cacheTitle') }}
        >
          <div className="flex w-max items-center gap-2">
            <TextInput
              search
              className="w-52 max-w-full shrink"
              placeholder={t('translate.cacheSearch')}
              value={qInput}
              disabled={busy}
              aria-label={t('translate.cacheSearch')}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitQ(qInput)
              }}
              onBlur={() => commitQ(qInput)}
            />
            <Select
              className="min-w-[7rem] max-w-[11rem] shrink [&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-[0.75rem]"
              value={srcLang}
              options={langOptions}
              disabled={busy}
              panelWidth="content"
              aria-label={t('translate.cacheFilterSrcLang')}
              onChange={(value) => setFilters({ page: 1, srcLang: parseCacheLang(value) })}
            />
            <Select
              className="min-w-[7rem] max-w-[11rem] shrink [&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-[0.75rem]"
              value={tgtLang}
              options={langOptions}
              disabled={busy}
              panelWidth="content"
              aria-label={t('translate.cacheFilterTgtLang')}
              onChange={(value) => setFilters({ page: 1, tgtLang: parseCacheLang(value) })}
            />
            <Select
              className="min-w-[7rem] max-w-[11rem] shrink [&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-[0.75rem]"
              value={engine}
              options={engineOptions}
              disabled={busy}
              panelWidth="content"
              aria-label={t('translate.cacheFilterEngine')}
              onChange={(v) => setFilters({ page: 1, engine: v })}
            />
            <Select
              className="min-w-[7rem] max-w-[11rem] shrink [&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-[0.75rem]"
              value={nsfwFlag}
              options={nsfwOptions}
              disabled={busy}
              panelWidth="content"
              aria-label={t('translate.cacheFilterNsfw')}
              onChange={(value) => setFilters({ page: 1, nsfwFlag: parseCacheNsfwFlag(value) })}
            />
            <Select
              className="min-w-[7rem] max-w-[11rem] shrink [&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-[0.75rem]"
              value={live}
              options={liveOptions}
              disabled={busy}
              panelWidth="content"
              aria-label={t('translate.cacheFilterLive')}
              onChange={(value) => setFilters({ page: 1, live: parseCacheLiveFlag(value) })}
            />
          </div>
        </ScrollArea>
        {onOpenDebug ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={CACHE_TEST_COPY[locale].intro}
            tooltip={CACHE_TEST_COPY[locale].debugTip}
            onClick={() => onOpenDebug(new URLSearchParams(patchSearchParams(searchParams, { q: qInput.trim() || null, ...(qInput.trim() !== q ? { page: null } : {}) })))}
          >
            <TbBug size={16} aria-hidden />
          </Button>
        ) : null}
      </PanelHeadEnd>

      <div className="flex min-h-0 flex-1 flex-col">
        {error ? (
          <EmptyState title={t('translate.cacheLoadFailTitle')} message={error} hint={t('translate.cacheLoadFailHint')} />
        ) : loading ? (
          <TranslateCacheTableSkeleton />
        ) : empty ? (
          <EmptyState
            title={hasFilter ? t('translate.cacheNoMatch') : t('translate.cacheEmpty')}
            message={hasFilter ? t('translate.cacheNoMatchMsg') : t('translate.cacheEmptyMsg')}
            hint={hasFilter ? t('translate.cacheNoMatchHint') : t('translate.cacheEmptyHint')}
          />
        ) : (
          <ScrollArea
            className="min-h-0 flex-1"
            restorationKey={`cache:${searchParams.toString()}`}
            indicator="both"
            scrollProps={{ 'aria-label': t('translate.cacheTableAria'), 'aria-busy': pending }}
          >
            <div className="w-full text-[0.8125rem]" style={{ minWidth: TRANSLATE_CACHE_GRID_MIN_WIDTH }} role="list" aria-label={t('translate.cacheTableAria')}>
              <div className="sticky top-0 z-[3] grid w-full items-center border-b border-line bg-paper-2" style={cacheGridStyle} role="presentation">
                {CACHE_COLUMN_DEFS.map((col) => {
                  const sortKey = col.sortKey
                  if (sortKey) {
                    return (
                      <SortableTh
                        key={col.key}
                        as="div"
                        className={cn(editHeadCell, col.align === 'right' && 'text-right')}
                        label={t(col.labelKey)}
                        active={sortExplicit && sort === sortKey}
                        order={order}
                        disabled={busy}
                        onCycle={() => toggleSort(sortKey)}
                      />
                    )
                  }
                  return (
                    <div key={col.key} className={cn(editHeadCell, col.align === 'right' && 'text-right')} data-list-heading="">
                      {t(col.labelKey)}
                    </div>
                  )
                })}
              </div>
              {(data?.items ?? []).map((row, i) => (
                <div
                  key={row.id || `${row.src}-${row.from || ''}-${row.to || ''}`}
                  data-navigation-id={row.id ? `cache:${row.id}` : undefined}
                  className={cn(
                    // Top-align so 原文/译文 share the same first/second line baseline (not vertically centered).
                    'grid w-full items-start border-t border-line hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
                    i === 0 && 'border-t-0'
                  )}
                  style={cacheGridStyle}
                  role="listitem"
                >
                  <div className={cn(editCell, 'group/cell relative min-w-0 text-left')} data-list-cell="" title={row.src}>
                    <div className="absolute top-1 right-1 z-10">
                      <CopyIconButton text={row.src} />
                    </div>
                    <div className={cn(cellClamp3, 'pr-6')}>{row.src}</div>
                  </div>
                  <div className={cn(editCell, 'group/cell relative min-w-0 text-left')} data-list-cell="" title={row.zh}>
                    <div className="absolute top-1 right-1 z-10">
                      <CopyIconButton text={row.zh} />
                    </div>
                    <div className={cn(cellClamp3, 'pr-6')}>{row.zh}</div>
                  </div>
                  <div className={cn(editCell, 'whitespace-nowrap')} data-list-cell="">
                    {row.from && row.to ? (
                      <span
                        className="inline-flex items-center gap-0.5 font-mono text-[0.7rem] tracking-wide text-ink-soft"
                        title={`${cacheLangLabel(row.from, t)} → ${cacheLangLabel(row.to, t)}`}
                      >
                        <span>{cacheLangCode(row.from)}</span>
                        <LiaExchangeAltSolid size={12} aria-hidden className="shrink-0 opacity-70" />
                        <span>{cacheLangCode(row.to)}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </div>
                  <div className={editCell} data-list-cell="">
                    <span className="inline-flex max-w-full items-center gap-1">
                      <TruncateText text={cacheEngineLabel(row.engine, t)} className="min-w-0 text-[0.75rem]" />
                      {isLiveCacheEngine(row.engine) ? (
                        <Badge tone="info" dot={false} className="shrink-0 px-1 text-[0.65rem]">
                          {t('translate.cacheLive')}
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                  <div className={cn(editCell, 'tabular-nums text-[0.75rem]')} data-list-cell="" title={String(row.hitCount)}>
                    {formatCacheHitCount(row.hitCount)}
                  </div>
                  <div
                    className={cn(editCell, 'whitespace-nowrap font-mono text-[0.7rem] text-ink-soft')}
                    data-list-cell=""
                    title={fmtTimeFull(row.updatedAt, LOCALE_HTML_LANG[locale])}
                  >
                    {formatCacheUpdatedAt(row.updatedAt)}
                  </div>
                  <div className={cn(editCell, 'text-right')} data-list-cell="">
                    <div className="inline-flex items-center justify-end gap-0">
                      <Button
                        variant="plain"
                        size="mini"
                        disabled={busy || !onOpenDetail || !row.id}
                        aria-label={t('translate.cacheDetail')}
                        data-navigation-trigger=""
                        onClick={() => onOpenDetail?.({ id: row.id, src: row.src, zh: row.zh, from: row.from, to: row.to })}
                      >
                        <TbPencil size={14} aria-hidden />
                      </Button>
                      <Button
                        variant="plain"
                        size="mini"
                        disabled={busy}
                        aria-label={row.nsfw ? t('translate.cacheClearNsfw') : t('translate.cacheMarkNsfw')}
                        aria-pressed={!!row.nsfw}
                        onClick={() => void askToggleNsfw(row)}
                      >
                        <TbRating18Plus size={14} aria-hidden className={row.nsfw ? 'text-warn' : undefined} />
                      </Button>
                      <Button variant="plain" size="mini" disabled={busy} aria-label={t('common.remove')} onClick={() => void askDelete(row)}>
                        <IoTrashOutline size={14} aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      <div className={panelFoot}>
        <span>{total ? `${rangeFrom}–${rangeTo} / ${total.toLocaleString()}` : t('translate.cacheTitle')}</span>
        <div className="inline-flex items-center gap-1">
          <label className="mr-1 inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem] text-ink-soft">
            <span>{t('translate.cachePageSize')}</span>
            <Select
              className="w-[4.75rem]"
              aria-label={t('translate.cachePageSize')}
              value={String(pageSize)}
              disabled={busy}
              panelWidth="content"
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(v) => setFilters({ page: 1, pageSize: snapPageSize(Number(v)) })}
            />
          </label>
          <span className="mr-0.5 tabular-nums">
            {visiblePage} / {totalPages}
          </span>
          <Button variant="ghost" size="icon" disabled={busy || visiblePage <= 1} aria-label={t('translate.cacheFirst')} onClick={() => go(1)}>
            <IoPlaySkipBackOutline size={16} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={busy || visiblePage <= 1} aria-label={t('translate.cachePrev')} onClick={() => go(visiblePage - 1)}>
            <IoChevronBackOutline size={16} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={busy || visiblePage >= totalPages} aria-label={t('translate.cacheNext')} onClick={() => go(visiblePage + 1)}>
            <IoChevronForwardOutline size={16} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={busy || visiblePage >= totalPages} aria-label={t('translate.cacheLast')} onClick={() => go(totalPages)}>
            <IoPlaySkipForwardOutline size={16} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}
