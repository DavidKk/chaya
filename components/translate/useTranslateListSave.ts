'use client'

import { useCallback, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import type { ExtractedLocalesMeta, ExtractedTranslationItem } from '@/services/extract/lib/extract-items'

type Props = {
  rgssEngine: 'VX Ace' | 'VX' | null
  contentRoot: string
  sourceLang: string
  targetLang: string
  localesMeta: ExtractedLocalesMeta | null
  pagedItems: ExtractedTranslationItem[]
  translationFetch: ReturnType<typeof useTranslationFetch>
  refreshUI: () => void
}

/** Scripts UI constants are listable but not in Data/*.rvdata writeback slots. */
function canRgssWriteback(rgssEngine: Props['rgssEngine'], item: ExtractedTranslationItem): boolean {
  return Boolean(rgssEngine) && !item.meta.isHardcoded
}

function saveItemBody(
  item: ExtractedTranslationItem,
  opts: { contentRoot: string; sourceLang: string; targetLang: string; localesMeta: ExtractedLocalesMeta | null; rgssEngine: Props['rgssEngine'] }
) {
  if (canRgssWriteback(opts.rgssEngine, item)) {
    return { mode: 'rgss-write' as const, contentRoot: opts.contentRoot, translations: { [item.src]: item.zh } }
  }
  return {
    mode: 'save-item' as const,
    text: item.src,
    zh: item.zh,
    localesKey: item.meta.localesKey,
    targetFile: item.meta.localesFile,
    sourceLang: opts.sourceLang || opts.localesMeta?.currentSourceLang,
    targetLang: opts.targetLang || opts.localesMeta?.currentTargetLang,
  }
}

export function useTranslateListSave({ rgssEngine, contentRoot, sourceLang, targetLang, localesMeta, pagedItems, translationFetch, refreshUI }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [savingPage, setSavingPage] = useState(false)
  const [resettingPage, setResettingPage] = useState(false)

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
      const writebackItems = itemsToSave.filter((item) => canRgssWriteback(rgssEngine, item))
      const cacheItems = itemsToSave.filter((item) => !canRgssWriteback(rgssEngine, item))
      let writebackError = ''
      if (writebackItems.length) {
        try {
          const response = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'rgss-write', contentRoot, translations: Object.fromEntries(writebackItems.map((item) => [item.src, item.zh])) }),
          })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(readApiErrorMessage(data))
          for (const item of writebackItems) {
            item.savedZh = item.zh
            savedCount++
          }
        } catch (error) {
          failCount += writebackItems.length
          writebackError = error instanceof Error ? error.message : String(error)
        }
      }
      for (const item of cacheItems) {
        try {
          const res = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saveItemBody(item, { contentRoot, sourceLang, targetLang, localesMeta, rgssEngine })),
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
      } else if (savedCount > 0) {
        notify.warning(t('translate.listSavePagePartial', { saved: savedCount, failed: failCount }))
      } else {
        notify.error(t('translate.listSingleSaveFailed', { error: writebackError || t('translate.listSavePagePartial', { saved: 0, failed: failCount }) }))
      }
    } finally {
      setSavingPage(false)
    }
  }, [contentRoot, confirm, pagedItems, rgssEngine, translationFetch, sourceLang, targetLang, localesMeta, refreshUI, notify, t])
  return { savingPage, resettingPage, handleSavePage, handleResetPage }
}
