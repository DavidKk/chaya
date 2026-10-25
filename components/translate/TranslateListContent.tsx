'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelFoot } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { PanelHeadEnd } from '@/components/PanelHeadEnd'
import { Button, EmptyState, LanguagePairSelect, NumberInput, ScrollArea, Select, type SelectOption, TextInput } from '@/components/sk'
import { AppleOfflineGuideModal } from '@/components/translate/AppleOfflineGuideModal'
import { useSafePathname, useSafeRouter, useSafeSearchParams } from '@/components/translate/safe-navigation'
import { translateRunHref } from '@/components/translate/tabs'
import { TranslateListFilters } from '@/components/translate/TranslateListFilters'
import { TranslateListItemRow } from '@/components/translate/TranslateListItemRow'
import { TranslateListPageActions } from '@/components/translate/TranslateListPageActions'
import { TranslateListSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { useSyncNames } from '@/components/translate/useSyncNames'
import { useTranslateListSave } from '@/components/translate/useTranslateListSave'
import { readApiErrorMessage } from '@/lib/api-error'
import { filterTranslationListItems } from '@/lib/translate/list-search'
import { detectSourceLanguage } from '@/lib/translate/source-text'
import { isManualTranslation } from '@/lib/translate/translation-source'
import { hrefWithQuery, parsePositiveInt, patchSearchParams } from '@/lib/url/search-params'
import type { ExtractedLocalesMeta, ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

export type AvailableEngine = {
  id: string
  label: string
  group: 'agent' | 'platform' | 'system'
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 50
/** Matches live-translate unique batch cap so page translate does not drop trailing items. */
const PAGE_TRANSLATE_BATCH = 40

export function TranslateListContent({ onExtract, onLanguagePairChange }: { onExtract?: () => void; onLanguagePairChange?: (pair: { source: string; target: string }) => void }) {
  const router = useSafeRouter()
  const pathname = useSafePathname()
  const searchParams = useSafeSearchParams()

  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const t = useT()

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ExtractedTranslationItem[]>([])
  const [localesMeta, setLocalesMeta] = useState<ExtractedLocalesMeta | null>(null)
  const [appleOfflineModal, setAppleOfflineModal] = useState<{ open: boolean; fromLang: string; toLang: string }>({
    open: false,
    fromLang: '',
    toLang: '',
  })

  // URL query parameters as the single source of truth for all filters
  const filterQuery = searchParams?.get('q') ?? ''
  const natureFilter = searchParams?.get('nature') ?? 'all'
  const categoryFilter = searchParams?.get('category') ?? 'all'
  const statusFilter = searchParams?.get('status') ?? 'all'
  const fromLangParam = searchParams?.get('from') ?? ''
  const toLangParam = searchParams?.get('to') ?? ''
  const page = parsePositiveInt(searchParams?.get('p') ?? null, 1)
  const rawPageSize = searchParams?.get('pageSize')
  const pageSize = rawPageSize ? parsePositiveInt(rawPageSize, DEFAULT_PAGE_SIZE, 200) : DEFAULT_PAGE_SIZE

  const [sourceLang, setSourceLang] = useState<string>(fromLangParam)
  const [targetLang, setTargetLang] = useState<string>(toLangParam)

  useEffect(() => {
    onLanguagePairChange?.({ source: sourceLang || localesMeta?.currentSourceLang || '', target: targetLang || localesMeta?.currentTargetLang || '' })
  }, [sourceLang, targetLang, localesMeta?.currentSourceLang, localesMeta?.currentTargetLang, onLanguagePairChange])

  // Search input typing draft
  const [qDraft, setQDraft] = useState(filterQuery)

  // Synchronize URL query changes
  const updateQueryParams = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      if (!router || !pathname) return
      const currentQuery = searchParams ? searchParams.toString() : ''
      const newQuery = patchSearchParams(searchParams || new URLSearchParams(), patch)
      if (newQuery !== currentQuery) {
        router.replace(hrefWithQuery(pathname, newQuery), { scroll: false })
      }
    },
    [router, pathname, searchParams]
  )

  // Sync draft when URL filterQuery changes
  useEffect(() => {
    setQDraft(filterQuery)
  }, [filterQuery])

  const commitSearch = useCallback(
    (next: string) => {
      const trimmed = next.trim()
      if (trimmed === filterQuery.trim()) {
        if (next !== trimmed) setQDraft(trimmed)
        return
      }
      setQDraft(trimmed)
      updateQueryParams({ q: trimmed || null, p: null })
    },
    [filterQuery, updateQueryParams]
  )

  // Jump page input (kept in sync with visible page for narrow mid-pager)
  const [jumpPageValue, setJumpPageValue] = useState<number>(1)

  const [availableEngines, setAvailableEngines] = useState<AvailableEngine[]>([])
  const [rgssEngine, setRgssEngine] = useState<'VX Ace' | 'VX' | null>(null)
  const [contentRoot, setContentRoot] = useState<string>('')
  const [selectedScheme, setSelectedScheme] = useState<string>('all')

  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [translatingPage, setTranslatingPage] = useState(false)

  // Invalidate derived filters and counts after in-place item edits.
  const refreshUI = useCallback(() => setItems((current) => [...current]), [])
  // 1. Load engines
  const loadEngines = useCallback(async () => {
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'switches' }),
      })
      const data = (await res.json()) as { ok?: boolean; switches?: Record<string, boolean>; agents?: Array<{ id: string; profileId?: string; enabled?: boolean }> }
      if (data?.ok && data.switches) {
        const list: AvailableEngine[] = []
        if (Array.isArray(data.agents)) {
          for (const agent of data.agents) {
            if (agent.enabled) {
              list.push({ id: `agent:${agent.id}`, label: `Agent (${agent.profileId || agent.id})`, group: 'agent' })
            }
          }
        }
        if (data.switches.bing) list.push({ id: 'bing', label: t('translate.engineBing'), group: 'platform' })
        if (data.switches.google) list.push({ id: 'google', label: t('translate.engineGoogle'), group: 'platform' })
        if (data.switches.apple) list.push({ id: 'apple', label: t('translate.engineApple'), group: 'system' })
        if (data.switches.bergamot) list.push({ id: 'bergamot', label: t('translate.engineBergamot'), group: 'system' })
        setAvailableEngines(list)
      }
    } catch {
      // ignore
    }
  }, [translationFetch, t])

  // 2. Load extracted items (server may return preparing — poll until ready; never block other APIs)
  const loadData = useCallback(
    async (customSourceLang?: string, customTargetLang?: string) => {
      setLoading(true)
      const srcL = customSourceLang ?? (sourceLang || fromLangParam)
      const tgtL = customTargetLang ?? (targetLang || toLangParam)
      const bodyBase = {
        mode: 'extract-items' as const,
        sourceLang: srcL || undefined,
        targetLang: tgtL || undefined,
      }
      try {
        const deadline = Date.now() + 120_000
        let poll = false
        for (;;) {
          const res = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...bodyBase, ...(poll ? { poll: true } : {}) }),
          })
          const data = (await res.json()) as {
            ok?: boolean
            preparing?: boolean
            items?: ExtractedTranslationItem[]
            locales?: ExtractedLocalesMeta
            engine?: 'VX Ace' | 'VX' | null
            contentRoot?: string
            error?: unknown
          }
          if (!res.ok || data.ok === false) {
            notify.error(t('translate.listFetchExtractFailed', { error: readApiErrorMessage(data) }))
            return
          }
          if (data.preparing) {
            if (Date.now() > deadline) {
              notify.error(t('translate.listFetchExtractFailed', { error: 'timeout' }))
              return
            }
            poll = true
            await new Promise((r) => setTimeout(r, 200))
            continue
          }
          if (Array.isArray(data.items)) {
            setItems(data.items)
            if (data.engine) setRgssEngine(data.engine)
            if (data.contentRoot) setContentRoot(data.contentRoot)
            if (data.locales?.hasLocales) {
              setLocalesMeta(data.locales)
              if (!sourceLang && data.locales.currentSourceLang) setSourceLang(data.locales.currentSourceLang)
              if (!targetLang && data.locales.currentTargetLang) setTargetLang(data.locales.currentTargetLang)
            } else if (!sourceLang) setSourceLang(detectSourceLanguage(data.items.map((item) => item.src)))
          } else {
            notify.error(t('translate.listFetchExtractFailed', { error: readApiErrorMessage(data) }))
          }
          return
        }
      } catch (err) {
        notify.error(t('translate.listFetchExtractFailed', { error: err instanceof Error ? err.message : String(err) }))
      } finally {
        setLoading(false)
      }
    },
    [sourceLang, targetLang, fromLangParam, toLangParam, translationFetch, notify, t]
  )

  const initialLoadedRef = useRef(false)
  useEffect(() => {
    if (initialLoadedRef.current) return
    initialLoadedRef.current = true
    void loadEngines()
    void loadData()
    if (typeof fetch === 'function') {
      void fetch('/api/status', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: { ready?: boolean; engine?: string; contentRoot?: string }) => {
          setRgssEngine(data.ready && (data.engine === 'VX Ace' || data.engine === 'VX') ? (data.engine as 'VX Ace' | 'VX') : null)
          if (data.contentRoot) setContentRoot(data.contentRoot)
        })
        .catch(() => setRgssEngine(null))
    }
  }, [loadEngines, loadData])

  const filteredItems = useMemo(
    () => filterTranslationListItems(items, { nature: natureFilter, category: categoryFilter, status: statusFilter, query: filterQuery }),
    [items, natureFilter, categoryFilter, statusFilter, filterQuery]
  )

  // Paging calculations
  const totalItems = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const visiblePage = Math.min(page, totalPages)

  // Navigate to page using URL param `p=xxx`
  const go = useCallback(
    (targetPage: number) => {
      const p = Math.max(1, Math.min(totalPages, targetPage))
      updateQueryParams({ p: p <= 1 ? null : String(p) })
    },
    [totalPages, updateQueryParams]
  )

  // Reset to page 1 if query / filter changes make the current page out of bounds
  useEffect(() => {
    if (page > totalPages && totalPages >= 1) {
      go(1)
    }
  }, [filterQuery, natureFilter, categoryFilter, statusFilter, pageSize, totalPages, page, go])

  const pagedItems = useMemo(() => {
    const start = (visiblePage - 1) * pageSize
    return filteredItems.slice(start, start + pageSize)
  }, [filteredItems, visiblePage, pageSize])

  const rangeFrom = totalItems === 0 ? 0 : (visiblePage - 1) * pageSize + 1
  const rangeTo = Math.min(visiblePage * pageSize, totalItems)

  useEffect(() => {
    setJumpPageValue(visiblePage)
  }, [visiblePage])

  // Handle jump to page
  const handleJumpSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (jumpPageValue >= 1 && jumpPageValue <= totalPages) {
      go(jumpPageValue)
    } else {
      notify.warning(t('translate.listPageInvalid', { total: totalPages }))
    }
  }

  // Stats
  const translatedCount = useMemo(() => items.filter((it) => Boolean(it.zh && it.zh.trim())).length, [items])

  // Translate single item
  const handleTranslate = useCallback(
    async (item: ExtractedTranslationItem, scheme?: string) => {
      const targetScheme = scheme || selectedScheme
      setTranslatingId(item.id)
      try {
        const isCache = targetScheme === 'cache'
        const enginesToUse = targetScheme === 'all' || isCache ? undefined : [targetScheme]
        const fromLang = sourceLang || localesMeta?.currentSourceLang || 'ja'
        const toLang = targetLang || localesMeta?.currentTargetLang || 'zh'
        const payload = isCache
          ? { mode: 'cache', text: item.src }
          : {
              text: item.src,
              force: true,
              persist: false,
              engines: enginesToUse,
              sourceLang: fromLang,
              targetLang: toLang,
              category: item.meta.category,
              speaker: item.meta.speaker,
              context: item.meta.context || item.meta.label,
            }
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json()) as { ok?: boolean; items?: Array<{ zh?: string; error?: string }>; error?: unknown }
        if (data?.ok && Array.isArray(data.items) && data.items[0]?.zh) {
          item.zh = data.items[0].zh
          item.engine = targetScheme === 'all' ? 'platform' : targetScheme
          refreshUI()
          notify.success(t('translate.listSingleTransSuccess', { src: item.src.slice(0, 20), zh: item.zh.slice(0, 20) }))
        } else {
          const rawErr = data?.items?.[0]?.error || readApiErrorMessage(data) || (isCache ? t('translate.listSingleCacheMiss') : '')
          const isAppleMissingPack =
            typeof rawErr === 'string' &&
            rawErr.toLowerCase().includes('apple') &&
            (rawErr.includes('not installed') || rawErr.includes('not_installed') || rawErr.includes('Unable to Translate'))
          if (isAppleMissingPack) {
            setAppleOfflineModal({
              open: true,
              fromLang: fromLang || localesMeta?.currentSourceLang || 'ja',
              toLang: toLang || localesMeta?.currentTargetLang || 'zh',
            })
          }
          const displayErr = isAppleMissingPack ? t('translate.appleOfflinePackMissing') : rawErr
          notify.error(t('translate.listSingleTransNoResult', { error: displayErr }))
        }
      } catch (err) {
        notify.error(t('translate.listSingleTransReqFailed', { error: err instanceof Error ? err.message : String(err) }))
      } finally {
        setTranslatingId(null)
      }
    },
    [selectedScheme, sourceLang, targetLang, localesMeta, translationFetch, refreshUI, notify, t]
  )

  const { savingId, savingPage, resettingPage, handleSave, handleSavePage, handleResetPage } = useTranslateListSave({
    rgssEngine,
    contentRoot,
    sourceLang,
    targetLang,
    localesMeta,
    pagedItems,
    translationFetch,
    refreshUI,
  })
  const selectedNameSrcs = useMemo(
    () =>
      natureFilter === 'name' || ['actor', 'actor_nickname', 'item', 'weapon', 'armor', 'skill', 'enemy', 'state', 'map'].includes(categoryFilter)
        ? [...new Set(filteredItems.filter((item) => item.zh && item.zh.trim() && item.zh !== item.src).map((item) => item.src))]
        : [],
    [categoryFilter, filteredItems, natureFilter]
  )
  const { running: syncingNames, runSyncNames } = useSyncNames({ names: selectedNameSrcs, sourceLang, targetLang, onDone: loadData })

  const handleFindSimilar = useCallback(
    (item: ExtractedTranslationItem) => {
      if (!router) {
        updateQueryParams({ q: item.src, nature: null, category: null, status: null, from: null, to: null, p: null })
        return
      }
      router.push(hrefWithQuery(translateRunHref('list'), new URLSearchParams({ q: item.src }).toString()))
    },
    [router, updateQueryParams]
  )

  const handleTranslatePage = useCallback(async () => {
    if (pagedItems.length === 0) {
      notify.warning(t('translate.listTranslatePageEmpty'))
      return
    }

    // 手动翻译权重最高，一键全页翻译必须受保护跳过，严禁触发或覆盖！
    const candidates = pagedItems.filter((item) => !isManualTranslation(item))
    const skippedManualCount = pagedItems.length - candidates.length

    if (candidates.length === 0) {
      notify.info(t('translate.listTranslatePageAllManual'))
      return
    }

    setTranslatingPage(true)
    const fromLang = sourceLang || localesMeta?.currentSourceLang || 'ja'
    const toLang = targetLang || localesMeta?.currentTargetLang || 'zh'
    const isCache = selectedScheme === 'cache'
    const enginesToUse = selectedScheme === 'all' || isCache ? undefined : [selectedScheme]
    let okCount = 0
    let failCount = 0
    let lastError = ''
    let sawAppleMissingPack = false
    try {
      for (let offset = 0; offset < candidates.length; offset += PAGE_TRANSLATE_BATCH) {
        const chunk = candidates.slice(offset, offset + PAGE_TRANSLATE_BATCH)
        if (isCache) {
          for (const item of chunk) {
            try {
              const res = await translationFetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'cache', text: item.src }),
              })
              const data = (await res.json()) as { ok?: boolean; items?: Array<{ zh?: string; error?: string }>; error?: unknown }
              const zh = data?.ok && Array.isArray(data.items) ? data.items[0]?.zh : ''
              if (zh) {
                item.zh = zh
                item.engine = 'cache'
                okCount += 1
              } else {
                failCount += 1
                lastError = data?.items?.[0]?.error || readApiErrorMessage(data) || t('translate.listSingleCacheMiss')
              }
            } catch (err) {
              failCount += 1
              lastError = err instanceof Error ? err.message : String(err)
            }
          }
          refreshUI()
          continue
        }
        try {
          const res = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              texts: chunk.map((item) => item.src),
              force: true,
              persist: false,
              engines: enginesToUse,
              sourceLang: fromLang,
              targetLang: toLang,
            }),
          })
          const data = (await res.json()) as {
            ok?: boolean
            items?: Array<{ src?: string; zh?: string; error?: string }>
            error?: unknown
          }
          if (!data?.ok || !Array.isArray(data.items)) {
            failCount += chunk.length
            lastError = readApiErrorMessage(data)
            const rawErr = lastError
            if (
              typeof rawErr === 'string' &&
              rawErr.toLowerCase().includes('apple') &&
              (rawErr.includes('not installed') || rawErr.includes('not_installed') || rawErr.includes('Unable to Translate'))
            ) {
              sawAppleMissingPack = true
            }
            continue
          }
          const bySrc = new Map<string, { zh?: string; error?: string }>()
          for (const row of data.items) {
            if (row?.src) bySrc.set(row.src, row)
          }
          for (const item of chunk) {
            const hit = bySrc.get(item.src)
            if (hit?.zh) {
              item.zh = hit.zh
              item.engine = selectedScheme === 'all' ? 'platform' : selectedScheme
              okCount += 1
            } else {
              failCount += 1
              const rawErr = hit?.error || ''
              if (
                typeof rawErr === 'string' &&
                rawErr.toLowerCase().includes('apple') &&
                (rawErr.includes('not installed') || rawErr.includes('not_installed') || rawErr.includes('Unable to Translate'))
              ) {
                sawAppleMissingPack = true
              }
              if (rawErr) lastError = rawErr
            }
          }
          refreshUI()
        } catch (err) {
          failCount += chunk.length
          lastError = err instanceof Error ? err.message : String(err)
        }
      }
      if (sawAppleMissingPack) {
        setAppleOfflineModal({ open: true, fromLang, toLang })
      }
      if (failCount === 0) {
        if (skippedManualCount > 0) {
          notify.success(t('translate.listTranslatePageSuccessWithSkipped', { ok: okCount, skipped: skippedManualCount }))
        } else {
          notify.success(t('translate.listTranslatePageSuccess', { count: okCount }))
        }
      } else if (okCount > 0) {
        notify.warning(t('translate.listTranslatePagePartial', { ok: okCount, failed: failCount }))
      } else {
        notify.error(
          t('translate.listTranslatePageFailed', {
            error: sawAppleMissingPack ? t('translate.appleOfflinePackMissing') : lastError || t('translate.listTranslatePagePartial', { ok: 0, failed: failCount }),
          })
        )
      }
    } finally {
      setTranslatingPage(false)
    }
  }, [pagedItems, selectedScheme, sourceLang, targetLang, localesMeta, translationFetch, refreshUI, notify, t])

  // Reset single item (reverts to original text without auto-saving)
  const handleReset = useCallback(
    (item: ExtractedTranslationItem) => {
      const originalText = item.initialZh ?? item.savedZh ?? ''
      item.zh = originalText
      refreshUI()
      notify.info(t('translate.listSingleResetSuccess'))
    },
    [refreshUI, notify, t]
  )

  const activeSchemeLabel = useMemo(() => {
    if (selectedScheme === 'all') return t('translate.listSchemeSmart')
    if (selectedScheme === 'cache') return t('translate.listSchemeCache')
    const found = availableEngines.find((e) => e.id === selectedScheme)
    return found ? found.label : t('translate.listSchemeSmart')
  }, [selectedScheme, availableEngines, t])

  const schemeOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: 'all', label: t('translate.listSchemeSmart') }]
    const agents = availableEngines.filter((e) => e.group === 'agent')
    const platform = availableEngines.filter((e) => e.group === 'platform')
    const system = availableEngines.filter((e) => e.group === 'system')

    // 1. 模型翻译 (Agent)
    if (agents.length > 0) {
      agents.forEach((eng, i) => {
        opts.push({ value: eng.id, label: eng.label, divider: i === 0 })
      })
    }
    // 2. 翻译平台服务 (Bing, Google)
    if (platform.length > 0) {
      platform.forEach((eng, i) => {
        opts.push({ value: eng.id, label: eng.label, divider: i === 0 })
      })
    }
    // 3. 系统原生离线翻译 (Apple 原生)
    if (system.length > 0) {
      system.forEach((eng, i) => {
        opts.push({ value: eng.id, label: eng.label, divider: i === 0 })
      })
    }
    // 4. 缓存翻译（放最后）
    opts.push({ value: 'cache', label: t('translate.listSchemeCache'), divider: true })

    return opts
  }, [availableEngines, t])

  if (loading) {
    return <TranslateListSkeleton />
  }

  if (!items.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <EmptyState title={t('translate.listEmptyExtractTitle')} message={t('translate.listEmptyExtractMsg')}>
          {onExtract ? (
            <div className="mt-4">
              <Button variant="accent" onClick={onExtract}>
                {t('translate.listEmptyExtractAction')}
              </Button>
            </div>
          ) : null}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PanelHeadEnd>
        <div className="flex flex-nowrap items-center justify-end gap-2">
          <TextInput
            className="w-48 shrink-0"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commitSearch(qDraft)
              }
            }}
            onKeyUp={(e) => {
              e.stopPropagation()
            }}
            onBlur={() => commitSearch(qDraft)}
            placeholder={t('translate.listSearchPlaceholder')}
            search
            aria-label={t('translate.listSearchAria')}
          />

          <TranslateListFilters
            natureFilter={natureFilter}
            categoryFilter={categoryFilter}
            statusFilter={statusFilter}
            onNature={(val) => updateQueryParams({ nature: val === 'all' ? null : val, p: null })}
            onCategory={(val) => updateQueryParams({ category: val === 'all' ? null : val, p: null })}
            onStatus={(val) => updateQueryParams({ status: val === 'all' ? null : val, p: null })}
          />
        </div>
      </PanelHeadEnd>

      {/* Top Controls: 语向 / 方案 + 批量操作（窄屏横滑不换行） */}
      <div className="shrink-0 border-b border-line bg-surface/10 select-none">
        <ScrollArea
          indicator="horizontal"
          reserveGutter={false}
          className="min-w-0"
          scrollClassName="flex w-full items-center justify-end"
          scrollProps={{ 'aria-label': t('translate.listGlobalSchemeAria'), tabIndex: 0 }}
        >
          <div className="flex min-w-max flex-nowrap items-center justify-end gap-2 px-4 py-2">
            <LanguagePairSelect
              className="shrink-0"
              sourceLang={sourceLang || localesMeta?.currentSourceLang || 'ja'}
              targetLang={targetLang || localesMeta?.currentTargetLang || 'zh'}
              availableLanguages={localesMeta?.availableLanguages}
              onSourceChange={(l) => {
                setSourceLang(l)
                updateQueryParams({ from: l, p: null })
                void loadData(l, targetLang || localesMeta?.currentTargetLang)
              }}
              onTargetChange={(l) => {
                setTargetLang(l)
                updateQueryParams({ to: l, p: null })
                void loadData(sourceLang || localesMeta?.currentSourceLang, l)
              }}
            />

            <Select
              className="w-36 shrink-0"
              panelWidth="content"
              value={selectedScheme}
              onChange={(val) => setSelectedScheme(val)}
              options={schemeOptions}
              aria-label={t('translate.listGlobalSchemeAria')}
              tooltip={t('translate.listGlobalSchemeTooltip', { label: activeSchemeLabel })}
            />

            <div className="mx-0.5 h-3.5 w-px shrink-0 bg-line" aria-hidden="true" />

            {/* 工具栏图标与 Select 同档：中性 ghost；色义留给行内文字钮。顺序：重置 → 翻译 → 同步 → 保存 */}
            <TranslateListPageActions
              resettingPage={resettingPage}
              translatingPage={translatingPage}
              savingPage={savingPage}
              syncingNames={syncingNames}
              emptyPage={pagedItems.length === 0}
              schemeLabel={activeSchemeLabel}
              onReset={() => void handleResetPage()}
              onTranslate={() => void handleTranslatePage()}
              onSyncNames={() => void runSyncNames()}
              onSave={() => void handleSavePage()}
              syncDisabled={!selectedNameSrcs.length}
            />
          </div>
        </ScrollArea>
      </div>

      {/* Paged List Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {pagedItems.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-soft">{t('translate.listEmptyFiltered')}</div>
        ) : (
          <ScrollArea className="h-full" indicator="vertical" reserveGutter={false}>
            <div className="flex flex-col divide-y divide-line">
              {pagedItems.map((item) => (
                <TranslateListItemRow
                  key={item.id}
                  item={item}
                  itemZh={item.zh}
                  savedZh={item.savedZh}
                  activeSchemeLabel={activeSchemeLabel}
                  isTranslating={translatingPage || translatingId === item.id}
                  isSaving={savingId === item.id}
                  isResetting={false}
                  onTranslate={handleTranslate}
                  onSave={handleSave}
                  onFindSimilar={handleFindSimilar}
                  onReset={handleReset}
                  onUpdate={refreshUI}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Bottom: desktop = stats + full pager; narrow = first/prev/page/next */}
      <div className={`${panelFoot} max-md:justify-center`}>
        <div className="hidden md:flex items-center gap-1.5 text-xs select-none">
          <span className="font-medium text-ink">{t('translate.listStatsCount')}</span>
          <span className="font-mono font-semibold text-accent">{translatedCount.toLocaleString()}</span>
          <span className="font-mono text-ink-soft">/</span>
          <span className="font-mono text-ink">{items.length.toLocaleString()}</span>
          <span className="text-ink-soft text-[0.6875rem] ml-2">{t('translate.listPageRange', { from: rangeFrom, to: rangeTo, total: totalItems.toLocaleString() })}</span>
        </div>

        <div className="inline-flex items-center gap-1.5">
          <label className="mr-1 hidden md:inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem] text-ink-soft">
            <span>{t('translate.listPageSizeLabel')}</span>
            <Select
              className="w-[4.75rem]"
              aria-label={t('translate.listPageSizeAria')}
              tooltip={t('translate.listPageSizeTooltip')}
              value={String(pageSize)}
              panelWidth="content"
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(v) => updateQueryParams({ pageSize: Number(v) === DEFAULT_PAGE_SIZE ? null : v, p: null })}
            />
          </label>

          <span className="mr-1 hidden md:inline tabular-nums text-ink">
            {visiblePage} / {totalPages}
          </span>

          <Button variant="ghost" size="icon" disabled={visiblePage <= 1} aria-label={t('translate.listPageFirst')} tooltip={t('translate.listPageFirst')} onClick={() => go(1)}>
            <IoPlaySkipBackOutline size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={visiblePage <= 1}
            aria-label={t('translate.listPagePrev')}
            tooltip={t('translate.listPagePrev')}
            onClick={() => go(visiblePage - 1)}
          >
            <IoChevronBackOutline size={14} aria-hidden />
          </Button>

          {/* Narrow: page in the middle; commit (blur/enter) jumps immediately — no 跳转 button. */}
          {totalPages > 1 ? (
            <NumberInput
              min={1}
              max={totalPages}
              value={jumpPageValue}
              onValueChange={(val) => {
                setJumpPageValue(val)
                if (val >= 1 && val <= totalPages) go(val)
              }}
              className="!h-7 w-14 text-xs px-1 text-center font-sans md:hidden"
              aria-label={t('translate.listJumpPageAria')}
              tooltip={t('translate.listJumpPageTooltip')}
            />
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            disabled={visiblePage >= totalPages}
            aria-label={t('translate.listPageNext')}
            tooltip={t('translate.listPageNext')}
            onClick={() => go(visiblePage + 1)}
          >
            <IoChevronForwardOutline size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            disabled={visiblePage >= totalPages}
            aria-label={t('translate.listPageLast')}
            tooltip={t('translate.listPageLast')}
            onClick={() => go(totalPages)}
          >
            <IoPlaySkipForwardOutline size={14} aria-hidden />
          </Button>

          {/* Desktop: jump form with button when many pages. */}
          {totalPages > 10 ? (
            <form onSubmit={handleJumpSubmit} className="hidden md:inline-flex items-center gap-1 shrink-0">
              <NumberInput
                min={1}
                max={totalPages}
                value={jumpPageValue}
                onValueChange={(val) => setJumpPageValue(val)}
                className="!h-7 w-16 text-xs px-1 text-center font-sans"
                aria-label={t('translate.listJumpPageAria')}
                tooltip={t('translate.listJumpPageTooltip')}
              />
              <Button type="submit" variant="default" className="!h-7 px-2.5 text-xs whitespace-nowrap shrink-0" tooltip={t('translate.listJumpPageTooltip')}>
                {t('translate.listJumpPageBtn')}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <AppleOfflineGuideModal {...appleOfflineModal} onClose={() => setAppleOfflineModal((prev) => ({ ...prev, open: false }))} />
    </div>
  )
}
