'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoCreateOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline, IoTrashOutline } from 'react-icons/io5'
import { RiTranslateAi2 } from 'react-icons/ri'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { panelFoot } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { PanelHeadEnd } from '@/components/PanelHeadEnd'
import { Badge, Button, DataTable, type DataTableColumn, EmptyState, Modal, ScrollArea, Select, TextInput } from '@/components/sk'
import { filterToggle, filterToggleOnWarn, formControlChrome, formControlPadX } from '@/components/sk/control'
import { TRANSLATE_CACHE_COLUMN_WIDTHS, TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import { LOCALE_HTML_LANG } from '@/lib/i18n'
import { parseSharedCacheSortDir, parseSharedCacheSortKey, type SharedCacheSortDir, type SharedCacheSortKey } from '@/lib/translate/cache-query'
import { cycleThreeStateSort } from '@/lib/ui/three-state-sort'
import { parsePositiveInt, patchSearchParams } from '@/lib/url/search-params'
import { cn } from '@/lib/utils'

type CacheItem = {
  src: string
  zh: string
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
  key: SharedCacheSortKey | 'ops' | 'src' | 'zh' | 'engine'
  labelKey: 'translate.cacheSrc' | 'translate.cacheZh' | 'translate.cacheEngine' | 'translate.cacheHits' | 'translate.cacheUpdated' | 'translate.cacheOps'
  width: string
  sortKey?: SharedCacheSortKey
}[] = [
  { key: 'src', labelKey: 'translate.cacheSrc', width: TRANSLATE_CACHE_COLUMN_WIDTHS.src },
  { key: 'zh', labelKey: 'translate.cacheZh', width: TRANSLATE_CACHE_COLUMN_WIDTHS.zh },
  { key: 'engine', labelKey: 'translate.cacheEngine', width: TRANSLATE_CACHE_COLUMN_WIDTHS.engine },
  { key: 'hits', labelKey: 'translate.cacheHits', width: TRANSLATE_CACHE_COLUMN_WIDTHS.hits, sortKey: 'hits' },
  { key: 'updated', labelKey: 'translate.cacheUpdated', width: TRANSLATE_CACHE_COLUMN_WIDTHS.updated, sortKey: 'updated' },
  { key: 'ops', labelKey: 'translate.cacheOps', width: TRANSLATE_CACHE_COLUMN_WIDTHS.ops },
]

function snapPageSize(n: number) {
  if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n
  return DEFAULT_PAGE_SIZE
}

function fmtTime(ts: number, locale: string) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(locale, { hour12: false })
}

const cellClamp3 = 'line-clamp-3 break-words whitespace-pre-line leading-snug'
const nsfwBadgeClass = 'relative -top-px ml-2 inline-flex align-middle font-bold tracking-[0.04em]'

type EditState = { src: string; zh: string; nsfw?: boolean }

type QueryState = {
  searchParams: Pick<URLSearchParams, 'get' | 'has' | 'toString'>
  replaceQuery: (patch: Record<string, string | null | undefined>) => void
}

/** 局内查询只改本地状态；Web 页由路由传 URL 参数，表格逻辑完全共用。 */
export function CacheBrowserOverlay() {
  const [searchParams, setSearchParams] = useState(() => new URLSearchParams())
  const replaceQuery = useCallback((patch: Record<string, string | null | undefined>) => {
    setSearchParams((current) => new URLSearchParams(patchSearchParams(current, patch)))
  }, [])
  return <CacheBrowserContent searchParams={searchParams} replaceQuery={replaceQuery} />
}

/** 本作翻译库内容（外壳 / 二级 tabs 由宿主提供） */
export function CacheBrowserContent({ searchParams, replaceQuery }: QueryState) {
  const t = useT()
  const locale = useLocaleCode()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const confirm = useConfirm()
  const columns = useMemo(
    () =>
      CACHE_COLUMN_DEFS.map((col) => ({
        key: col.key,
        label: t(col.labelKey),
        width: col.width,
        ...(col.sortKey ? { sortKey: col.sortKey } : {}),
      })) as DataTableColumn<SharedCacheSortKey>[],
    [t]
  )
  const page = parsePositiveInt(searchParams.get('page'), 1)
  const pageSize = snapPageSize(parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 200))
  const q = searchParams.get('q') ?? ''
  const engine = searchParams.get('engine') ?? ''
  const nsfwOnly = searchParams.get('nsfw') === '1' || searchParams.get('nsfw') === 'true'
  /** URL 显式带了 sort/order = 用户选过；否则为还原态（默认按更新降序，表头不点亮） */
  const sortExplicit = searchParams.has('sort') || searchParams.has('order')
  const sort = parseSharedCacheSortKey(searchParams.get('sort'), DEFAULT_SORT)
  const order = parseSharedCacheSortDir(searchParams.get('order'), DEFAULT_ORDER)
  const [qInput, setQInput] = useState(q)
  const [data, setData] = useState<CachePage | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [retranslatingSrc, setRetranslatingSrc] = useState<string | null>(null)

  useEffect(() => {
    setQInput(q)
  }, [q])

  const load = useCallback(
    async (opts: { page: number; pageSize: number; q: string; engine: string; nsfw: boolean; sort: SharedCacheSortKey; order: SharedCacheSortDir }) => {
      const params = new URLSearchParams({
        page: String(opts.page),
        pageSize: String(opts.pageSize),
        sort: opts.sort,
        order: opts.order,
      })
      if (opts.q) params.set('q', opts.q)
      if (opts.engine) params.set('engine', opts.engine)
      if (opts.nsfw) params.set('nsfw', '1')
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
    startTransition(() => {
      void load({ page, pageSize, q, engine, nsfw: nsfwOnly, sort, order })
    })
  }, [load, page, pageSize, q, engine, nsfwOnly, sort, order])

  function setFilters(patch: {
    page?: number
    pageSize?: number
    q?: string
    engine?: string
    nsfw?: boolean
    sort?: SharedCacheSortKey
    order?: SharedCacheSortDir
    /** true：写入显式排序；false：还原默认并清掉 URL 排序参数 */
    sortExplicit?: boolean
  }) {
    const nextPage = patch.page ?? page
    const nextSize = patch.pageSize ?? pageSize
    const nextQ = patch.q ?? q
    const nextEngine = patch.engine ?? engine
    const nextNsfw = patch.nsfw ?? nsfwOnly
    const nextExplicit = patch.sortExplicit ?? sortExplicit
    const nextSort = patch.sort ?? sort
    const nextOrder = patch.order ?? order
    replaceQuery({
      page: nextPage <= 1 ? null : String(nextPage),
      pageSize: nextSize === DEFAULT_PAGE_SIZE ? null : String(nextSize),
      q: nextQ || null,
      engine: nextEngine || null,
      nsfw: nextNsfw ? '1' : null,
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
    startTransition(() => {
      void load({ page, pageSize, q, engine, nsfw: nsfwOnly, sort, order })
    })
  }

  async function saveEdit(nextZh: string) {
    if (!edit) return
    const zh = nextZh.trim()
    if (!zh) {
      notify.error(t('translate.cacheZhEmpty'))
      return
    }
    setSaving(true)
    try {
      const res = await translationFetch('/api/translate-cache', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: edit.src, zh }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string; message?: string }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('notify.saveFailed')))
        return
      }
      notify.success(t('translate.cacheZhUpdated'))
      setEdit(null)
      reload()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('notify.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function askRetranslate(row: CacheItem) {
    if (retranslatingSrc) return
    const ok = await confirm({
      title: t('translate.cacheRetranslateTitle'),
      description: t('translate.cacheRetranslateDesc'),
      confirmLabel: t('translate.cacheRetranslate'),
      onConfirm: async () => {
        setRetranslatingSrc(row.src)
        try {
          const res = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: row.src, force: true }),
          })
          const json = (await res.json()) as {
            ok?: boolean
            items?: Array<{ src: string; zh: string | null; error?: string; engine?: string }>
            error?: string
            message?: string
          }
          if (!res.ok || json.ok === false) {
            const msg = readApiErrorMessage(json, t('translate.cacheRetranslateFailed'))
            notify.error(msg)
            throw new Error(msg)
          }
          const item = json.items?.[0]
          if (!item?.zh) {
            const msg = item?.error || t('translate.cacheNoResult')
            notify.error(msg)
            throw new Error(msg)
          }
        } finally {
          setRetranslatingSrc(null)
        }
      },
    })
    if (ok) {
      notify.success(t('translate.cacheRetranslated'))
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
          body: JSON.stringify({ src: row.src }),
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
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const loading = pending && !data
  const empty = Boolean(data && data.items.length === 0)
  const busy = pending || saving || Boolean(retranslatingSrc)
  const engines = data?.engines ?? []
  const engineOptions = [{ value: '', label: t('translate.cacheAllEngines') }, ...engines.map((e) => ({ value: e, label: e }))]
  const hasFilter = Boolean(q || engine || nsfwOnly)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeadEnd>
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
          value={engine}
          options={engineOptions}
          disabled={busy}
          panelWidth="content"
          aria-label={t('translate.cacheFilterEngine')}
          onChange={(v) => setFilters({ page: 1, engine: v })}
        />
        <button
          type="button"
          role="switch"
          aria-checked={nsfwOnly}
          disabled={busy}
          aria-label={nsfwOnly ? t('translate.cacheNsfwOff') : t('translate.cacheNsfwOn')}
          title={nsfwOnly ? t('translate.cacheNsfwOff') : t('translate.cacheNsfwOn')}
          className={cn(filterToggle, nsfwOnly && filterToggleOnWarn)}
          onClick={() => setFilters({ page: 1, nsfw: !nsfwOnly })}
        >
          NSFW
        </button>
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
          <ScrollArea className="min-h-0 flex-1" indicator="both" scrollProps={{ 'aria-label': t('translate.cacheTableAria') }}>
            <DataTable
              className="table-fixed min-w-[56rem] [&_td]:max-w-none"
              columns={columns}
              sort={{ key: sort, order, explicit: sortExplicit }}
              onSortCycle={toggleSort}
              disabled={busy}
            >
              {(data?.items ?? []).map((row, i) => (
                <tr key={`${row.src}-${i}`}>
                  <td className="align-top" title={row.src}>
                    <div className={cellClamp3}>
                      {row.src}
                      {row.nsfw ? (
                        <Badge tone="warn" dot={false} className={nsfwBadgeClass}>
                          NSFW
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="align-top" title={row.zh}>
                    <div className={cellClamp3}>{row.zh}</div>
                  </td>
                  <td className="truncate" title={row.engine || undefined}>
                    {row.engine || '—'}
                  </td>
                  <td className="tabular-nums">{row.hitCount}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{fmtTime(row.updatedAt, LOCALE_HTML_LANG[locale])}</td>
                  <td className="align-middle">
                    <div className="inline-flex items-center gap-[0.2rem]">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        loading={retranslatingSrc === row.src}
                        aria-label={t('translate.cacheRetranslate')}
                        tooltip={t('translate.cacheRetranslate')}
                        onClick={() => void askRetranslate(row)}
                      >
                        <RiTranslateAi2 size={16} aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={t('translate.cacheModify')}
                        tooltip={t('translate.cacheModify')}
                        onClick={() => setEdit({ src: row.src, zh: row.zh, nsfw: row.nsfw })}
                      >
                        <IoCreateOutline size={16} aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={busy} aria-label={t('common.remove')} tooltip={t('common.remove')} onClick={() => void askDelete(row)}>
                        <IoTrashOutline size={16} aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          </ScrollArea>
        )}
      </div>

      <div className={panelFoot}>
        <span>{total ? `${from}–${to} / ${total.toLocaleString()}` : t('translate.cacheTitle')}</span>
        <div className="inline-flex items-center gap-[0.35rem]">
          <label className="mr-1 inline-flex items-center gap-[0.35rem] whitespace-nowrap text-[0.7rem] text-ink-soft">
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
          <span className="mr-[0.1rem] tabular-nums">
            {page} / {totalPages}
          </span>
          <Button variant="ghost" size="icon" disabled={busy || page <= 1} aria-label={t('translate.cacheFirst')} tooltip={t('translate.cacheFirst')} onClick={() => go(1)}>
            <IoPlaySkipBackOutline size={16} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={busy || page <= 1} aria-label={t('translate.cachePrev')} tooltip={t('translate.cachePrev')} onClick={() => go(page - 1)}>
            <IoChevronBackOutline size={16} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy || page >= totalPages}
            aria-label={t('translate.cacheNext')}
            tooltip={t('translate.cacheNext')}
            onClick={() => go(page + 1)}
          >
            <IoChevronForwardOutline size={16} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy || page >= totalPages}
            aria-label={t('translate.cacheLast')}
            tooltip={t('translate.cacheLast')}
            onClick={() => go(totalPages)}
          >
            <IoPlaySkipForwardOutline size={16} aria-hidden />
          </Button>
        </div>
      </div>

      {edit ? (
        <CacheEditDialog
          src={edit.src}
          zh={edit.zh}
          nsfw={!!edit.nsfw}
          saving={saving}
          onClose={() => {
            if (!saving && !retranslatingSrc) setEdit(null)
          }}
          onSave={(zh) => void saveEdit(zh)}
        />
      ) : null}
    </div>
  )
}

function CacheEditDialog({
  src,
  zh,
  nsfw,
  saving,
  onClose,
  onSave,
}: {
  src: string
  zh: string
  nsfw?: boolean
  saving: boolean
  onClose: () => void
  onSave: (zh: string) => void
}) {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const [draft, setDraft] = useState(zh)
  const [translating, setTranslating] = useState(false)
  const busy = saving || translating

  async function runTranslate() {
    if (busy) return
    setTranslating(true)
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: src, force: true, persist: false }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        items?: Array<{ src: string; zh: string | null; error?: string }>
        error?: string
        message?: string
      }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.cacheTranslateFailed')))
        return
      }
      const item = json.items?.[0]
      if (!item?.zh) {
        notify.error(item?.error || t('translate.cacheNoResult'))
        return
      }
      setDraft(item.zh)
      notify.success(t('translate.cacheFilled'))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.cacheTranslateFailed'))
    } finally {
      setTranslating(false)
    }
  }

  return (
    <Modal
      open
      title={t('translate.cacheEditTitle')}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" disabled={busy} loading={translating} onClick={() => void runTranslate()}>
            <RiTranslateAi2 size={16} aria-hidden />
            {t('translate.cacheRetranslate')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={saving} disabled={busy || !draft.trim() || draft.trim() === zh} onClick={() => onSave(draft)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.7rem] font-medium text-ink-soft">{t('translate.cacheSrc')}</span>
        <ScrollArea
          className="max-h-24 rounded-[0.15rem] border border-line bg-paper"
          indicator="vertical"
          reserveGutter={false}
          scrollProps={{ 'aria-label': t('translate.cacheSrc') }}
        >
          <div className="px-[0.55rem] py-[0.45rem] text-[0.8125rem] leading-snug whitespace-pre-wrap break-words text-ink">
            {src}
            {nsfw ? (
              <Badge tone="warn" dot={false} className={nsfwBadgeClass}>
                NSFW
              </Badge>
            ) : null}
          </div>
        </ScrollArea>
      </div>
      <label className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.7rem] font-medium text-ink-soft">{t('translate.cacheZh')}</span>
        <textarea
          className={cn(
            formControlChrome,
            formControlPadX,
            'h-auto min-h-[6.5rem] resize-none py-[0.45rem] leading-snug focus:border-accent disabled:cursor-not-allowed disabled:opacity-45'
          )}
          value={draft}
          disabled={busy}
          aria-label={t('translate.cacheZh')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (draft.trim() && draft.trim() !== zh) onSave(draft)
            }
          }}
        />
      </label>
    </Modal>
  )
}
