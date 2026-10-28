'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { BergamotPackGuide } from '@/components/translate/BergamotPackGuide'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import { isActivePackJob, type PackPlan } from '@/lib/translate/bergamot'

export function BergamotPackInstaller({
  source,
  target,
  embedded = false,
  onInstalled,
  onPlanChange,
}: {
  source: string
  target: string
  /** Fold into parent offline-status chrome (no duplicate title/badge/pair). */
  embedded?: boolean
  onInstalled: () => void
  onPlanChange?: (plan?: PackPlan) => void
}) {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const [plan, setPlan] = useState<PackPlan>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const completed = useRef('')
  const snapshot = useRef<PackPlan | undefined>(undefined)
  const callback = useRef(onInstalled)
  callback.current = onInstalled
  const planCallback = useRef(onPlanChange)
  planCallback.current = onPlanChange
  const lifetime = useRef<AbortController | null>(null)
  const request = useCallback(
    async (action: string, current?: PackPlan, signal?: AbortSignal, force = false) => {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ mode: 'bergamot-packs', action, from: source, to: target, planId: current?.id, jobId: current?.job?.id, force }),
      })
      const data = (await res.json()) as unknown as PackPlan & { ok?: boolean; error?: unknown }
      if (!res.ok || data.ok === false) throw new Error(res.status === 403 ? t('translate.packConsoleRequired') : readApiErrorMessage(data, t('translate.offlineCheckFailed')))
      if (signal?.aborted) return
      const previous = snapshot.current
      if (
        previous?.id &&
        previous.id === data.id &&
        previous.job &&
        (!data.job || previous.job.updatedAt > data.job.updatedAt || (previous.job.id === data.job.id && previous.job.revision > data.job.revision))
      )
        return
      snapshot.current = data
      setPlan(data)
      setError('')
      if (action === 'status' && data.job?.state === 'completed' && completed.current !== data.job.id) {
        completed.current = data.job.id
        callback.current()
      }
    },
    [translationFetch, source, target, t]
  )

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    snapshot.current = undefined
    setPlan(undefined)
    setError('')
    setBusy(false)
    completed.current = ''
    void request('plan', undefined, controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [request])

  const active = !!plan?.job && isActivePackJob(plan.job)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await request('status', undefined, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error))
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 1000)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [active, request])

  async function act(action: 'install' | 'reinstall' | 'cancel' | 'plan') {
    const signal = lifetime.current?.signal
    setBusy(true)
    try {
      if (action === 'reinstall') {
        await request('install', plan, signal, true)
      } else {
        await request(action, plan, signal)
      }
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  return <BergamotPackGuide plan={plan} error={error} busy={busy} embedded={embedded} onAction={(action) => void act(action)} />
}
