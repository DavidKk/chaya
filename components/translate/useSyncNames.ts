'use client'

import { useCallback, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'

type ScanNames = {
  candidates?: Array<{ src: string; oldZh: string; newZh: string; via?: string }>
  skippedProtected?: number
  unchanged?: number
  review?: number
  nameCount?: number
}

type ApplyNames = {
  applied?: number
  skippedCount?: number
  review?: number
  pausedReason?: string
  totalProcessed?: number
}

export function useSyncNames(opts?: { names?: string[]; onDone?: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const translationFetch = useTranslationFetch()
  const [running, setRunning] = useState(false)
  const names = opts?.names
  const onDone = opts?.onDone

  const runSyncNames = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      const scanRes = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'optimize', action: 'scan-names', names: names?.length ? names : undefined }),
      })
      const scanData = (await scanRes.json()) as { ok?: boolean; error?: unknown } & ScanNames
      if (!scanData?.ok) {
        notify.error(t('translate.syncNamesFailed', { error: readApiErrorMessage(scanData) }))
        return
      }
      const writable = (scanData.candidates || []).filter((item) => item.via !== 'review')
      if (!writable.length) {
        notify.info(t('translate.syncNamesScanEmpty'))
        return
      }
      const preview = writable[0]
      const ok = await confirm({
        title: t('translate.syncNamesConfirmTitle'),
        description: t('translate.syncNamesConfirmDesc', {
          total: writable.length,
          review: scanData.review ?? 0,
          sample: preview ? `${preview.oldZh} → ${preview.newZh}` : '',
        }),
        confirmLabel: t('translate.syncNamesConfirm'),
      })
      if (!ok) return
      const runRes = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'optimize', action: 'apply-names', names: names?.length ? names : undefined, limit: 80 }),
      })
      const runData = (await runRes.json()) as { ok?: boolean; error?: unknown } & ApplyNames
      if (!runData?.ok) {
        notify.error(t('translate.syncNamesFailed', { error: readApiErrorMessage(runData) }))
        return
      }
      if (runData.pausedReason) {
        notify.warning(t('translate.syncNamesPaused', { reason: runData.pausedReason, done: runData.totalProcessed ?? 0 }))
      } else {
        notify.success(t('translate.syncNamesDone', { applied: runData.applied ?? 0, skipped: runData.skippedCount ?? 0, review: runData.review ?? 0 }))
      }
      onDone?.()
    } catch (err) {
      notify.error(t('translate.syncNamesFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setRunning(false)
    }
  }, [confirm, names, notify, onDone, running, t, translationFetch])

  return { running, runSyncNames }
}
