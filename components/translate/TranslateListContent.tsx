'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline } from 'react-icons/io5'
import { LuDatabase, LuRefreshCw } from 'react-icons/lu'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { panelFoot } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, EmptyState, LanguagePairSelect, NumberInput, ScrollArea, Select, Spinner, TextInput } from '@/components/sk'
import { TranslateListItemRow } from '@/components/translate/TranslateListItemRow'
import { TranslateListSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import { hrefWithQuery, parsePositiveInt, patchSearchParams } from '@/lib/url/search-params'
import type { ExtractedLocalesMeta, ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

export type AvailableEngine = {
  id: string
  label: string
  group: 'agent' | 'platform' | 'system'
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 50

export function TranslateListContent({ onExtract }: { onExtract?: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const confirm = useConfirm()
  const t = useT()

  const [loading, setLoading] = useState(true)
  const [savingPage, setSavingPage] = useState(false)
  const [resettingPage, setResettingPage] = useState(false)
  const [items, setItems] = useState<ExtractedTranslationItem[]>([])
  const [localesMeta, setLocalesMeta] = useState<ExtractedLocalesMeta | null>(null)

  // URL query parameters as the single source of truth for all filters
  const filterQuery = searchParams?.get('q') ?? ''
  const categoryFilter = searchParams?.get('category') ?? 'all'
  const statusFilter = searchParams?.get('status') ?? 'all'
  const fromLangParam = searchParams?.get('from') ?? ''
  const toLangParam = searchParams?.get('to') ?? ''
  const page = parsePositiveInt(searchParams?.get('p') ?? null, 1)
  const rawPageSize = searchParams?.get('pageSize')
  const pageSize = rawPageSize ? parsePositiveInt(rawPageSize, DEFAULT_PAGE_SIZE, 200) : DEFAULT_PAGE_SIZE

  const [sourceLang, setSourceLang] = useState<string>(fromLangParam)
  const [targetLang, setTargetLang] = useState<string>(toLangParam)
  const [prewarming, setPrewarming] = useState(false)

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

  // Debounced update for search box typing
  useEffect(() => {
    if (qDraft === filterQuery) return
    const timer = setTimeout(() => {
      updateQueryParams({ q: qDraft.trim() || null, p: null })
    }, 300)
    return () => clearTimeout(timer)
  }, [qDraft, filterQuery, updateQueryParams])

  // Jump page input
  const [jumpPageValue, setJumpPageValue] = useState<number>(1)

  const [availableEngines, setAvailableEngines] = useState<AvailableEngine[]>([])
  const [selectedScheme, setSelectedScheme] = useState<string>('all')

  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  // Force re-render token when in-place item edits happen
  const [, setTick] = useState(0)
  const refreshUI = useCallback(() => setTick((t) => t + 1), [])

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
        setAvailableEngines(list)
      }
    } catch {
      // ignore
    }
  }, [translationFetch, t])

  // 2. Load extracted items
  const loadData = useCallback(
    async (customSourceLang?: string, customTargetLang?: string) => {
      setLoading(true)
      const srcL = customSourceLang ?? (sourceLang || fromLangParam)
      const tgtL = customTargetLang ?? (targetLang || toLangParam)
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'extract-items',
            sourceLang: srcL || undefined,
            targetLang: tgtL || undefined,
          }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          items?: ExtractedTranslationItem[]
          locales?: ExtractedLocalesMeta
          error?: unknown
        }
        if (data?.ok && Array.isArray(data.items)) {
          setItems(data.items)
          if (data.locales?.hasLocales) {
            setLocalesMeta(data.locales)
            if (!sourceLang && data.locales.currentSourceLang) setSourceLang(data.locales.currentSourceLang)
            if (!targetLang && data.locales.currentTargetLang) setTargetLang(data.locales.currentTargetLang)
          }
        } else {
          notify.error(t('translate.listFetchExtractFailed', { error: readApiErrorMessage(data) }))
        }
      } catch (err) {
        notify.error(t('translate.listFetchExtractFailed', { error: err instanceof Error ? err.message : String(err) }))
      } finally {
        setLoading(false)
      }
    },
    [sourceLang, targetLang, fromLangParam, toLangParam, translationFetch, notify, t]
  )

  const handlePrewarm = useCallback(async () => {
    setPrewarming(true)
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'import-locales-corpus' }),
      })
      const data = (await res.json()) as { ok?: boolean; inserted?: number; totalPairs?: number; error?: unknown }
      if (data?.ok) {
        notify.success(t('translate.listPrewarmSuccess', { count: data.inserted?.toLocaleString() || 0 }))
      } else {
        notify.error(t('translate.listPrewarmFailed', { error: readApiErrorMessage(data) }))
      }
    } catch (err) {
      notify.error(t('translate.listPrewarmFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setPrewarming(false)
    }
  }, [translationFetch, notify, t])

  useEffect(() => {
    void loadEngines()
    void loadData()
  }, [loadEngines, loadData])

  // Filter items
  const filteredItems = useMemo(() => {
    let list = items
    if (categoryFilter !== 'all') {
      list = list.filter((it) => it.meta.category === categoryFilter)
    }
    if (statusFilter === 'untranslated') {
      list = list.filter((it) => !it.zh || !it.zh.trim())
    } else if (statusFilter === 'translated') {
      list = list.filter((it) => Boolean(it.zh && it.zh.trim()))
    }
    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase()
      list = list.filter(
        (it) => it.src.toLowerCase().includes(q) || it.zh.toLowerCase().includes(q) || it.meta.speaker?.toLowerCase().includes(q) || it.meta.context?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, categoryFilter, statusFilter, filterQuery])

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
  }, [filterQuery, categoryFilter, statusFilter, pageSize, totalPages, page, go])

  const pagedItems = useMemo(() => {
    const start = (visiblePage - 1) * pageSize
    return filteredItems.slice(start, start + pageSize)
  }, [filteredItems, visiblePage, pageSize])

  const rangeFrom = totalItems === 0 ? 0 : (visiblePage - 1) * pageSize + 1
  const rangeTo = Math.min(visiblePage * pageSize, totalItems)

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
        const enginesToUse = targetScheme === 'all' ? undefined : [targetScheme]
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: item.src,
            force: true,
            persist: false,
            engines: enginesToUse,
          }),
        })
        const data = (await res.json()) as { ok?: boolean; items?: Array<{ zh?: string }>; error?: unknown }
        if (data?.ok && Array.isArray(data.items) && data.items[0]?.zh) {
          item.zh = data.items[0].zh
          refreshUI()
          notify.success(t('translate.listSingleTransSuccess', { src: item.src.slice(0, 20), zh: item.zh.slice(0, 20) }))
        } else {
          notify.error(t('translate.listSingleTransNoResult', { error: readApiErrorMessage(data) }))
        }
      } catch (err) {
        notify.error(t('translate.listSingleTransReqFailed', { error: err instanceof Error ? err.message : String(err) }))
      } finally {
        setTranslatingId(null)
      }
    },
    [selectedScheme, translationFetch, refreshUI, notify, t]
  )

  // Save single item
  const handleSave = useCallback(
    async (item: ExtractedTranslationItem) => {
      setSavingId(item.id)
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'save-item',
            text: item.src,
            zh: item.zh,
            localesKey: item.meta.localesKey,
            targetFile: item.meta.localesFile,
            sourceLang: sourceLang || localesMeta?.currentSourceLang,
            targetLang: targetLang || localesMeta?.currentTargetLang,
          }),
        })
        const data = (await res.json()) as { ok?: boolean; backupCreated?: boolean; error?: unknown }
        if (data?.ok) {
          item.savedZh = item.zh
          refreshUI()
          const backupMsg = data.backupCreated ? t('translate.listSingleSaveBackup') : ''
          notify.success(t('translate.listSingleSaveSuccess', { backup: backupMsg }))
        } else {
          notify.error(t('translate.listSingleSaveFailed', { error: readApiErrorMessage(data) }))
        }
      } catch (err) {
        notify.error(t('translate.listSingleSaveReqFailed', { error: err instanceof Error ? err.message : String(err) }))
      } finally {
        setSavingId(null)
      }
    },
    [sourceLang, targetLang, localesMeta, translationFetch, refreshUI, notify, t]
  )

  // Reset all items on current page with confirmation (does not auto-save)
  const handleResetPage = useCallback(async () => {
    if (pagedItems.length === 0) return
    const ok = await confirm({
      title: t('translate.listResetPageTitle'),
      description: t('translate.listResetPageDesc', { count: pagedItems.length }),
      confirmLabel: t('translate.listResetPageConfirm'),
      confirmVariant: 'fail',
    })
    if (!ok) return

    setResettingPage(true)
    try {
      for (const item of pagedItems) {
        const orig = item.initialZh ?? item.savedZh ?? ''
        item.zh = orig
      }
      refreshUI()
      notify.info(t('translate.listResetPageSuccess', { count: pagedItems.length }))
    } finally {
      setResettingPage(false)
    }
  }, [confirm, pagedItems, refreshUI, notify, t])

  // Save all translated items on current page with confirmation
  const handleSavePage = useCallback(async () => {
    const itemsToSave = pagedItems.filter((it) => (it.zh && it.zh.trim()) || Boolean(it.savedZh))
    if (itemsToSave.length === 0) {
      notify.warning(t('translate.listSavePageEmpty'))
      return
    }

    const ok = await confirm({
      title: t('translate.listSavePageTitle'),
      description: t('translate.listSavePageDesc', { count: itemsToSave.length }),
      confirmLabel: t('translate.listSavePageConfirm'),
      confirmVariant: 'ok',
    })
    if (!ok) return

    setSavingPage(true)
    let savedCount = 0
    let failCount = 0
    try {
      for (const item of itemsToSave) {
        try {
          const res = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'save-item',
              text: item.src,
              zh: item.zh,
              localesKey: item.meta.localesKey,
              targetFile: item.meta.localesFile,
              sourceLang: sourceLang || localesMeta?.currentSourceLang,
              targetLang: targetLang || localesMeta?.currentTargetLang,
            }),
          })
          const data = (await res.json()) as { ok?: boolean }
          if (data?.ok) {
            item.savedZh = item.zh
            savedCount++
          } else {
            failCount++
          }
        } catch {
          failCount++
        }
      }
      refreshUI()
      if (failCount === 0) {
        notify.success(t('translate.listSavePageSuccess', { count: savedCount }))
      } else {
        notify.warning(t('translate.listSavePagePartial', { saved: savedCount, failed: failCount }))
      }
    } finally {
      setSavingPage(false)
    }
  }, [confirm, pagedItems, translationFetch, sourceLang, targetLang, localesMeta, refreshUI, notify, t])

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
    const found = availableEngines.find((e) => e.id === selectedScheme)
    return found ? found.label : t('translate.listSchemeSmart')
  }, [selectedScheme, availableEngines, t])

  const schemeOptions = useMemo(() => {
    const opts = [{ value: 'all', label: t('translate.listSchemeSmart') }]
    const agents = availableEngines.filter((e) => e.group === 'agent')
    const system = availableEngines.filter((e) => e.group === 'system')
    const platform = availableEngines.filter((e) => e.group === 'platform')

    for (const eng of agents) opts.push({ value: eng.id, label: eng.label })
    for (const eng of system) opts.push({ value: eng.id, label: eng.label })
    for (const eng of platform) opts.push({ value: eng.id, label: eng.label })
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
      {/* Top Controls Bar: Search & Filters */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line px-4 py-2 shrink-0 select-none">
        {/* [Filter Bar] | [Tools Bar] */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. 筛选条 (位于最左侧) */}
          <TextInput
            className="w-[17.5rem]"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateQueryParams({ q: qDraft.trim() || null, p: null })
              }
            }}
            placeholder={t('translate.listSearchPlaceholder')}
            search
            aria-label={t('translate.listSearchAria')}
          />

          <Select
            className="w-36"
            panelWidth="content"
            value={categoryFilter}
            onChange={(val) => updateQueryParams({ category: val === 'all' ? null : val, p: null })}
            options={[
              { value: 'all', label: t('translate.catAll') },
              { value: 'dialogue', label: t('translate.catDialogue') },
              { value: 'story', label: t('translate.catStory') },
              { value: 'choice', label: t('translate.catChoice') },
              { value: 'item', label: t('translate.catItem') },
              { value: 'item_desc', label: t('translate.catItemDesc') },
              { value: 'weapon', label: t('translate.catWeapon') },
              { value: 'weapon_desc', label: t('translate.catWeaponDesc') },
              { value: 'armor', label: t('translate.catArmor') },
              { value: 'armor_desc', label: t('translate.catArmorDesc') },
              { value: 'skill', label: t('translate.catSkill') },
              { value: 'skill_desc', label: t('translate.catSkillDesc') },
              { value: 'map', label: t('translate.catMap') },
              { value: 'actor', label: t('translate.catActor') },
              { value: 'actor_nickname', label: t('translate.catActorNickname') },
              { value: 'actor_profile', label: t('translate.catActorProfile') },
              { value: 'enemy', label: t('translate.catEnemy') },
              { value: 'state', label: t('translate.catState') },
              { value: 'system', label: t('translate.catSystem') },
              { value: 'plugin', label: t('translate.catPlugin') },
              { value: 'resource', label: t('translate.catResource') },
              { value: 'other', label: t('translate.catOther') },
            ]}
            aria-label={t('translate.listCategoryFilterAria')}
            tooltip={t('translate.listCategoryFilterTooltip')}
          />

          <Select
            className="w-28"
            panelWidth="content"
            value={statusFilter}
            onChange={(val) => updateQueryParams({ status: val === 'all' ? null : val, p: null })}
            options={[
              { value: 'all', label: t('translate.statusAll') },
              { value: 'untranslated', label: t('translate.statusUntranslated') },
              { value: 'translated', label: t('translate.statusTranslated') },
            ]}
            aria-label={t('translate.listStatusFilterAria')}
            tooltip={t('translate.listStatusFilterTooltip')}
          />

          {/* 分割线：隔开筛选条与功能条 */}
          <div className="mx-0.5 h-4 w-px bg-line shrink-0" aria-hidden="true" />

          {/* 2. 功能条 (位于筛选条右侧) */}
          <Select
            className="w-36"
            panelWidth="content"
            value={selectedScheme}
            onChange={(val) => setSelectedScheme(val)}
            options={schemeOptions}
            aria-label={t('translate.listGlobalSchemeAria')}
            tooltip={t('translate.listGlobalSchemeTooltip', { label: activeSchemeLabel })}
          />

          {localesMeta?.hasLocales ? (
            <div className="flex items-center gap-1.5">
              <LanguagePairSelect
                sourceLang={sourceLang || localesMeta.currentSourceLang}
                targetLang={targetLang || localesMeta.currentTargetLang}
                availableLanguages={localesMeta.availableLanguages}
                onSourceChange={(l) => {
                  setSourceLang(l)
                  updateQueryParams({ from: l, p: null })
                  void loadData(l, targetLang || localesMeta.currentTargetLang)
                }}
                onTargetChange={(l) => {
                  setTargetLang(l)
                  updateQueryParams({ to: l, p: null })
                  void loadData(sourceLang || localesMeta.currentSourceLang, l)
                }}
              />
              <Button
                size="icon"
                variant="default"
                disabled={prewarming}
                onClick={handlePrewarm}
                aria-label={t('translate.listPrewarmAria')}
                tooltip={t('translate.listPrewarmTooltip')}
                className="!h-8 !w-8"
              >
                {prewarming ? <Spinner size="sm" /> : <LuDatabase size={14} className="text-accent" />}
              </Button>
            </div>
          ) : null}

          {/* Refresh Icon Button */}
          <Button size="icon" variant="default" onClick={() => void loadData()} aria-label={t('translate.listReloadAria')} tooltip={t('translate.listReloadAria')}>
            <LuRefreshCw size={14} />
          </Button>
        </div>
      </div>

      {/* Paged List Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {pagedItems.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-soft">{t('translate.listEmptyFiltered')}</div>
        ) : (
          <ScrollArea className="h-full" indicator="vertical">
            <div className="flex flex-col divide-y divide-line">
              {pagedItems.map((item) => (
                <TranslateListItemRow
                  key={item.id}
                  item={item}
                  itemZh={item.zh}
                  savedZh={item.savedZh}
                  activeSchemeLabel={activeSchemeLabel}
                  isTranslating={translatingId === item.id}
                  isSaving={savingId === item.id}
                  isResetting={false}
                  onTranslate={handleTranslate}
                  onSave={handleSave}
                  onReset={handleReset}
                  onUpdate={refreshUI}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Bottom Panel Foot: Stats on Bottom-Left, Pagination on Bottom-Right */}
      <div className={panelFoot}>
        {/* Left: Translation counts (翻译数量: 0/100) */}
        <div className="flex items-center gap-1.5 text-xs select-none">
          <span className="font-medium text-ink">{t('translate.listStatsCount')}</span>
          <span className="font-mono font-semibold text-accent">{translatedCount.toLocaleString()}</span>
          <span className="font-mono text-ink-soft">/</span>
          <span className="font-mono text-ink">{items.length.toLocaleString()}</span>
          <span className="text-ink-soft text-[0.6875rem] ml-2">{t('translate.listPageRange', { from: rangeFrom, to: rangeTo, total: totalItems.toLocaleString() })}</span>
        </div>

        {/* Right: Pagination Controls */}
        <div className="inline-flex items-center gap-1.5">
          <label className="mr-1 inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem] text-ink-soft">
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

          <span className="mr-1 tabular-nums text-ink">
            {visiblePage} / {totalPages}
          </span>

          {/* Jump to page input: displayed when totalPages > 10 */}
          {totalPages > 10 ? (
            <form onSubmit={handleJumpSubmit} className="inline-flex items-center gap-1 mr-1 shrink-0">
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
            disabled={visiblePage >= totalPages}
            aria-label={t('translate.listPageLast')}
            tooltip={t('translate.listPageLast')}
            onClick={() => go(totalPages)}
          >
            <IoPlaySkipForwardOutline size={14} aria-hidden />
          </Button>

          {/* 分割线：隔开翻页与批量操作 */}
          <div className="mx-1 h-3.5 w-px bg-line shrink-0" aria-hidden="true" />

          {/* 批量重置当前页 */}
          <Button
            type="button"
            variant="fail"
            disabled={savingPage || resettingPage || pagedItems.length === 0}
            onClick={() => void handleResetPage()}
            tooltip={t('translate.listResetPageTooltip')}
            className="!h-7 px-2.5 text-xs whitespace-nowrap cursor-pointer"
          >
            {resettingPage ? <Spinner size="sm" /> : null}
            {t('translate.listResetPageBtn')}
          </Button>

          {/* 批量保存当前页 */}
          <Button
            type="button"
            variant="ok"
            disabled={savingPage || resettingPage || pagedItems.length === 0}
            onClick={() => void handleSavePage()}
            tooltip={t('translate.listSavePageTooltip')}
            className="!h-7 px-2.5 text-xs whitespace-nowrap font-medium cursor-pointer"
          >
            {savingPage ? <Spinner size="sm" /> : null}
            {t('translate.listSavePageBtn')}
          </Button>
        </div>
      </div>
    </div>
  )
}
