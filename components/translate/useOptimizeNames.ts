'use client'

import { useCallback, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'

type OptimizeScan = {
  totalCandidates?: number
  termFixable?: number
  termFixCandidates?: unknown[]
  polishCandidatesCount?: number
  skippedManual?: number
  alreadyOptimized?: number
}

type OptimizeRun = {
  termFixed?: number
  engineOptimized?: number
  skippedCount?: number
  pausedReason?: string
  totalProcessed?: number
}

export function useOptimizeNames(opts?: { engines?: string[]; onDone?: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const translationFetch = useTranslationFetch()
  const [running, setRunning] = useState(false)
  const engines = opts?.engines
  const onDone = opts?.onDone

  const runOptimizeNames = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      const scanRes = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'optimize', action: 'scan', scope: 'short-entities' }),
      })
      const scanData = (await scanRes.json()) as { ok?: boolean; error?: unknown } & OptimizeScan
      if (!scanData?.ok) {
        notify.error(t('translate.optimizeNamesFailed', { error: readApiErrorMessage(scanData) }))
        return
      }

      const terms = scanData.termFixable ?? scanData.termFixCandidates?.length ?? 0
      const engine = scanData.polishCandidatesCount ?? 0
      const total = scanData.totalCandidates ?? terms + engine
      if (total <= 0 && terms <= 0 && engine <= 0) {
        notify.info(t('translate.optimizeNamesScanEmpty'))
        return
      }

      const ok = await confirm({
        title: t('translate.optimizeNamesConfirmTitle'),
        description: t('translate.optimizeNamesConfirmDesc', { total, terms, engine }),
        confirmLabel: t('translate.optimizeNamesConfirm'),
      })
      if (!ok) return

      const runRes = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'optimize',
          action: 'short-entities',
          engines: engines?.length ? engines : undefined,
          limit: 40,
        }),
      })
      const runData = (await runRes.json()) as { ok?: boolean; error?: unknown } & OptimizeRun
      if (!runData?.ok) {
        notify.error(t('translate.optimizeNamesFailed', { error: readApiErrorMessage(runData) }))
        return
      }

      if (runData.pausedReason) {
        notify.warning(
          t('translate.optimizeNamesPaused', {
            reason: runData.pausedReason,
            done: runData.totalProcessed ?? 0,
          })
        )
      } else {
        notify.success(
          t('translate.optimizeNamesDone', {
            terms: runData.termFixed ?? 0,
            engine: runData.engineOptimized ?? 0,
            skipped: runData.skippedCount ?? 0,
          })
        )
      }
      onDone?.()
    } catch (err) {
      notify.error(t('translate.optimizeNamesFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setRunning(false)
    }
  }, [confirm, engines, notify, onDone, running, t, translationFetch])

  return { running, runOptimizeNames }
}
