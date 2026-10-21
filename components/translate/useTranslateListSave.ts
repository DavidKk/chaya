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

export function useTranslateListSave({ rgssEngine, contentRoot, sourceLang, targetLang, localesMeta, pagedItems, translationFetch, refreshUI }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savingPage, setSavingPage] = useState(false)
  const [resettingPage, setResettingPage] = useState(false)
  // Save single item
  const handleSave = useCallback(
    async (item: ExtractedTranslationItem) => {
      setSavingId(item.id)
      try {
        const writeback = Boolean(rgssEngine)
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: writeback ? 'rgss-write' : 'save-item',
            text: item.src,
            zh: item.zh,
            translations: writeback ? { [item.src]: item.zh } : undefined,
            contentRoot: writeback ? contentRoot : undefined,
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
    [contentRoot, rgssEngine, sourceLang, targetLang, localesMeta, translationFetch, refreshUI, notify, t]
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
      if (rgssEngine) {
        try {
          const response = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'rgss-write', contentRoot, translations: Object.fromEntries(itemsToSave.map((item) => [item.src, item.zh])) }),
          })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(readApiErrorMessage(data))
          for (const item of itemsToSave) item.savedZh = item.zh
          refreshUI()
          notify.success(t('translate.listSavePageSuccess', { count: itemsToSave.length }))
        } catch (error) {
          notify.error(t('translate.listSingleSaveFailed', { error: error instanceof Error ? error.message : String(error) }))
        }
        return
      }
      for (const item of itemsToSave) {
        try {
          const res = await translationFetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              rgssEngine
                ? { mode: 'rgss-write', contentRoot, translations: { [item.src]: item.zh } }
                : {
                    mode: 'save-item',
                    text: item.src,
                    zh: item.zh,
                    localesKey: item.meta.localesKey,
                    targetFile: item.meta.localesFile,
                    sourceLang: sourceLang || localesMeta?.currentSourceLang,
                    targetLang: targetLang || localesMeta?.currentTargetLang,
                  }
            ),
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
  }, [contentRoot, confirm, pagedItems, rgssEngine, translationFetch, sourceLang, targetLang, localesMeta, refreshUI, notify, t])
  return { savingId, savingPage, resettingPage, handleSave, handleSavePage, handleResetPage }
}
