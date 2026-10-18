'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline } from 'react-icons/io5'
import { LuDatabase, LuRefreshCw } from 'react-icons/lu'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
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
        if (data.switches.bing) list.push({ id: 'bing', label: 'Bing 翻译', group: 'platform' })
        if (data.switches.google) list.push({ id: 'google', label: 'Google 翻译', group: 'platform' })
        if (data.switches.apple) list.push({ id: 'apple', label: 'Apple 原生离线', group: 'system' })
        setAvailableEngines(list)
      }
    } catch {
      // ignore
    }
  }, [translationFetch])

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
          notify.error(`读取抽取词条失败: ${readApiErrorMessage(data)}`)
        }
      } catch (err) {
        notify.error(`读取抽取词条失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLoading(false)
      }
    },
    [sourceLang, targetLang, fromLangParam, toLangParam, translationFetch, notify]
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
        notify.success(`语料库预热成功：已将 ${data.inserted?.toLocaleString() || 0} 条双向对齐词条导入翻译库`)
      } else {
        notify.error(`预热失败: ${readApiErrorMessage(data)}`)
      }
    } catch (err) {
      notify.error(`预热失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPrewarming(false)
    }
  }, [translationFetch, notify])

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
      notify.warning(`请输入 1 到 ${totalPages} 之间的有效页码`)
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
          notify.success(`翻译完成: ${item.src.slice(0, 20)}... → ${item.zh.slice(0, 20)}...`)
        } else {
          notify.error(`翻译未返回有效结果: ${readApiErrorMessage(data)}`)
        }
      } catch (err) {
        notify.error(`翻译请求失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setTranslatingId(null)
      }
    },
    [selectedScheme, translationFetch, refreshUI, notify]
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
          const backupMsg = data.backupCreated ? '（已自动生成原文件 .bak 备份）' : ''
          notify.success(`词条已保存并更新到本地游戏${backupMsg}`)
        } else {
          notify.error(`保存失败: ${readApiErrorMessage(data)}`)
        }
      } catch (err) {
        notify.error(`保存请求失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setSavingId(null)
      }
    },
    [sourceLang, targetLang, localesMeta, translationFetch, refreshUI, notify]
  )

  // Reset all items on current page with confirmation (does not auto-save)
  const handleResetPage = useCallback(async () => {
    if (pagedItems.length === 0) return
    const ok = await confirm({
      title: '确认重置当前页所有译文？',
      description: `重置后，当前页共 ${pagedItems.length} 条文本的译文将恢复为原本的初始文案，未保存的修改将被撤销。此操作不会自动保存，确认后需手动点击「保存」。`,
      confirmLabel: '确认重置',
      confirmVariant: 'warn',
    })
    if (!ok) return

    setResettingPage(true)
    try {
      for (const item of pagedItems) {
        const orig = item.initialZh ?? item.savedZh ?? ''
        item.zh = orig
      }
      refreshUI()
      notify.info(`已重置当前页 ${pagedItems.length} 条文本为初始译文（未自动保存，确认后请点击保存）`)
    } finally {
      setResettingPage(false)
    }
  }, [confirm, pagedItems, refreshUI, notify])

  // Save all translated items on current page with confirmation
  const handleSavePage = useCallback(async () => {
    const itemsToSave = pagedItems.filter((it) => (it.zh && it.zh.trim()) || Boolean(it.savedZh))
    if (itemsToSave.length === 0) {
      notify.warning('当前页没有已填写的译文可供保存')
      return
    }

    const ok = await confirm({
      title: '确认保存当前页所有译文？',
      description: `即将把当前页 ${itemsToSave.length} 条文本保存并写入游戏。是否继续？`,
      confirmLabel: '确认保存',
      confirmVariant: 'accent',
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
        notify.success(`已成功保存当前页 ${savedCount} 条译文至游戏`)
      } else {
        notify.warning(`当前页保存完成：${savedCount} 条成功，${failCount} 条失败`)
      }
    } finally {
      setSavingPage(false)
    }
  }, [confirm, pagedItems, translationFetch, sourceLang, targetLang, localesMeta, refreshUI, notify])

  // Reset single item (reverts to original text without auto-saving)
  const handleReset = useCallback(
    (item: ExtractedTranslationItem) => {
      const originalText = item.initialZh ?? item.savedZh ?? ''
      item.zh = originalText
      refreshUI()
      notify.info('已恢复为原本的初始译文，未自动保存（确认无误后请手动点击「保存」）')
    },
    [refreshUI, notify]
  )

  const activeSchemeLabel = useMemo(() => {
    if (selectedScheme === 'all') return '智能翻译'
    const found = availableEngines.find((e) => e.id === selectedScheme)
    return found ? found.label : '智能翻译'
  }, [selectedScheme, availableEngines])

  const schemeOptions = useMemo(() => {
    const opts = [{ value: 'all', label: '智能翻译' }]
    const agents = availableEngines.filter((e) => e.group === 'agent')
    const system = availableEngines.filter((e) => e.group === 'system')
    const platform = availableEngines.filter((e) => e.group === 'platform')

    for (const eng of agents) opts.push({ value: eng.id, label: eng.label })
    for (const eng of system) opts.push({ value: eng.id, label: eng.label })
    for (const eng of platform) opts.push({ value: eng.id, label: eng.label })
    return opts
  }, [availableEngines])

  if (loading) {
    return <TranslateListSkeleton />
  }

  if (!items.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <EmptyState title="尚未抽取游戏文本" message="请先在「原文」标签页点击抽取文本，抽取完成后即可在此处浏览、检索并编辑每条翻译。">
          {onExtract ? (
            <div className="mt-4">
              <Button variant="accent" onClick={onExtract}>
                前往抽取文本
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 shrink-0 select-none">
        {/* Left: Summary hint */}
        <div className="text-xs text-ink-soft select-none">
          <span>共 {items.length.toLocaleString()} 条文本</span>
          {filteredItems.length !== items.length ? <span className="text-[0.6875rem] text-accent ml-1.5">(筛选出 {filteredItems.length.toLocaleString()} 条)</span> : null}
        </div>

        {/* Right: [Filter Bar] | [Tools Bar] */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. 筛选条 (放在右侧区域的最左边) */}
          <TextInput
            className="w-[20rem]"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateQueryParams({ q: qDraft.trim() || null, p: null })
              }
            }}
            placeholder="搜索原文、译文、说话人、场景或Key..."
            search
            aria-label="搜索文本"
          />

          <Select
            className="w-36"
            panelWidth="content"
            value={categoryFilter}
            onChange={(val) => updateQueryParams({ category: val === 'all' ? null : val, p: null })}
            options={[
              { value: 'all', label: '全部分类' },
              { value: 'dialogue', label: '对话' },
              { value: 'story', label: '剧情/旁白' },
              { value: 'choice', label: '选项' },
              { value: 'item', label: '物品' },
              { value: 'item_desc', label: '物品说明' },
              { value: 'weapon', label: '武器' },
              { value: 'weapon_desc', label: '武器说明' },
              { value: 'armor', label: '防具' },
              { value: 'armor_desc', label: '防具说明' },
              { value: 'skill', label: '技能' },
              { value: 'skill_desc', label: '技能说明' },
              { value: 'map', label: '地名' },
              { value: 'actor', label: '角色名' },
              { value: 'actor_nickname', label: '角色称号' },
              { value: 'actor_profile', label: '角色背景' },
              { value: 'enemy', label: '敌人' },
              { value: 'state', label: '状态' },
              { value: 'system', label: '系统文案' },
              { value: 'plugin', label: '插件参数' },
              { value: 'resource', label: '文本资源' },
              { value: 'other', label: '其他文本' },
            ]}
            aria-label="文本分类筛选"
            tooltip="按文本性质分类筛选（对话、说明、地名、角色等）"
          />

          <Select
            className="w-28"
            panelWidth="content"
            value={statusFilter}
            onChange={(val) => updateQueryParams({ status: val === 'all' ? null : val, p: null })}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'untranslated', label: '仅未翻译' },
              { value: 'translated', label: '仅已翻译' },
            ]}
            aria-label="翻译状态筛选"
            tooltip="按翻译状态筛选（全部状态、仅未翻译、仅已翻译）"
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
            aria-label="全局翻译方案"
            tooltip={`当前翻译方案: ${activeSchemeLabel}（在此切换后，全部条目的翻译统一生效）`}
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
                aria-label="预热语料库"
                tooltip="将游戏已有高质量多语言全排列对齐导入系统翻译库（零污染、只存文字）"
                className="!h-8 !w-8"
              >
                {prewarming ? <Spinner size="sm" /> : <LuDatabase size={14} className="text-accent" />}
              </Button>
            </div>
          ) : null}

          {/* Refresh Icon Button */}
          <Button size="icon" variant="default" onClick={() => void loadData()} aria-label="重新加载数据" tooltip="重新加载数据">
            <LuRefreshCw size={14} />
          </Button>
        </div>
      </div>

      {/* Paged List Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {pagedItems.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-soft">没有符合当前筛选条件的文本条目</div>
        ) : (
          <ScrollArea className="h-full" indicator="vertical">
            <div className="flex flex-col divide-y divide-line">
              {pagedItems.map((item) => (
                <TranslateListItemRow
                  key={item.id}
                  item={item}
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
          <span className="font-medium text-ink">翻译数量:</span>
          <span className="font-mono font-semibold text-accent">{translatedCount.toLocaleString()}</span>
          <span className="font-mono text-ink-soft">/</span>
          <span className="font-mono text-ink">{items.length.toLocaleString()}</span>
          <span className="text-ink-soft text-[0.6875rem] ml-2">
            ({rangeFrom}–{rangeTo} / 共 {totalItems.toLocaleString()} 条)
          </span>
        </div>

        {/* Right: Pagination Controls */}
        <div className="inline-flex items-center gap-1.5">
          <label className="mr-1 inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem] text-ink-soft">
            <span>每页条数</span>
            <Select
              className="w-[4.75rem]"
              aria-label="每页条数"
              tooltip="切换每页展示的文本条目数量"
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
                aria-label="跳转到指定页"
                tooltip="输入页码并按回车或点击跳转"
              />
              <Button type="submit" variant="default" className="!h-7 px-2.5 text-xs whitespace-nowrap shrink-0" tooltip="跳转到指定页">
                跳转
              </Button>
            </form>
          ) : null}

          <Button variant="ghost" size="icon" disabled={visiblePage <= 1} aria-label="第一页" tooltip="第一页" onClick={() => go(1)}>
            <IoPlaySkipBackOutline size={14} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={visiblePage <= 1} aria-label="上一页" tooltip="上一页" onClick={() => go(visiblePage - 1)}>
            <IoChevronBackOutline size={14} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={visiblePage >= totalPages} aria-label="下一页" tooltip="下一页" onClick={() => go(visiblePage + 1)}>
            <IoChevronForwardOutline size={14} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" disabled={visiblePage >= totalPages} aria-label="最后一页" tooltip="最后一页" onClick={() => go(totalPages)}>
            <IoPlaySkipForwardOutline size={14} aria-hidden />
          </Button>

          {/* 分割线：隔开翻页与批量操作 */}
          <div className="mx-1 h-3.5 w-px bg-line shrink-0" aria-hidden="true" />

          {/* 批量重置当前页 */}
          <Button
            type="button"
            variant="warn"
            disabled={savingPage || resettingPage || pagedItems.length === 0}
            onClick={() => void handleResetPage()}
            tooltip="重置当前页所有条目至初始译文（点击需二次确认）"
            className="!h-7 px-2.5 text-xs whitespace-nowrap cursor-pointer"
          >
            {resettingPage ? <Spinner size="sm" /> : null}
            重置
          </Button>

          {/* 批量保存当前页 */}
          <Button
            type="button"
            variant="accent"
            disabled={savingPage || resettingPage || pagedItems.length === 0}
            onClick={() => void handleSavePage()}
            tooltip="保存当前页的所有已翻译条目至游戏（点击需二次确认）"
            className="!h-7 px-2.5 text-xs whitespace-nowrap font-medium cursor-pointer"
          >
            {savingPage ? <Spinner size="sm" /> : null}
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
