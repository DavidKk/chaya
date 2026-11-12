'use client'

import { createElement, useCallback, useRef, useState } from 'react'

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
  previewId?: string
  pausedReason?: string
}

type ApplyNames = {
  applied?: number
  skippedCount?: number
  review?: number
  pausedReason?: string
  totalProcessed?: number
}

export function useSyncNames(opts?: { names?: string[]; sourceLang?: string; targetLang?: string; onDone?: () => void | Promise<void> }) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const translationFetch = useTranslationFetch()
  const [running, setRunning] = useState(false)
  const busy = useRef(false)
  const names = opts?.names
  const onDone = opts?.onDone
  const sourceLang = opts?.sourceLang
  const targetLang = opts?.targetLang

  const runSyncNames = useCallback(async () => {
    if (busy.current || names?.length === 0) return
    busy.current = true
    setRunning(true)
    try {
      const scanRes = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'optimize', action: 'scan-names', names, sourceLang, targetLang, limit: 80 }),
      })
      const scanData = (await scanRes.json()) as { ok?: boolean; error?: unknown } & ScanNames
      if (!scanData?.ok) {
        notify.error(t('translate.syncNamesFailed', { error: readApiErrorMessage(scanData, t('translate.requestFailed')) }))
        return
      }
      if (scanData.pausedReason) {
        notify.warning(t('translate.syncNamesPaused', { reason: scanData.pausedReason, done: 0 }))
        return
      }
      const writable = (scanData.candidates || []).filter((item) => item.via !== 'review')
      if (!writable.length || !scanData.previewId) {
        notify.info(t('translate.syncNamesScanEmpty'))
        return
      }
      const ok = await confirm({
        title: t('translate.syncNamesConfirmTitle'),
        description: createElement(
          'div',
          { className: 'space-y-3' },
          createElement('p', null, t('translate.syncNamesConfirmDesc', { total: writable.length, review: scanData.review ?? 0 })),
          createElement(
            'div',
            { className: 'space-y-3 whitespace-pre-wrap break-words' },
            ...writable.map((item) =>
              createElement(
                'div',
                { key: item.src, className: 'space-y-1 border-b border-line pb-2' },
                createElement('p', null, item.src),
                createElement('p', null, `${item.oldZh} → ${item.newZh}`)
              )
            )
          )
        ),
        confirmLabel: t('translate.syncNamesConfirm'),
      })
      if (!ok) return
      const runRes = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'optimize', action: 'apply-names', previewId: scanData.previewId, targetLang }),
      })
      const runData = (await runRes.json()) as { ok?: boolean; error?: unknown } & ApplyNames
      if (!runData?.ok) {
        notify.error(t('translate.syncNamesFailed', { error: readApiErrorMessage(runData, t('translate.requestFailed')) }))
        return
      }
      if (runData.pausedReason) {
        notify.warning(t('translate.syncNamesPaused', { reason: runData.pausedReason, done: runData.totalProcessed ?? 0 }))
      } else {
        notify.success(t('translate.syncNamesDone', { applied: runData.applied ?? 0, skipped: runData.skippedCount ?? 0, review: runData.review ?? 0 }))
      }
      await onDone?.()
    } catch (err) {
      notify.error(t('translate.syncNamesFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      busy.current = false
      setRunning(false)
    }
  }, [confirm, names, notify, onDone, sourceLang, targetLang, t, translationFetch])

  return { running, runSyncNames }
}
