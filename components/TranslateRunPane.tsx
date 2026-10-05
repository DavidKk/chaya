'use client'

import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { IoCloudUploadOutline, IoPauseOutline, IoPlayOutline } from 'react-icons/io5'
import { LuScanText } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, ScrollArea, SegmentedNav, TruncateText } from '@/components/sk'
import { TranslateActivityLog, type TranslateLogEntry } from '@/components/translate/TranslateActivityLog'
import { type EngineId, TranslateEngineRail } from '@/components/translate/TranslateEngineRail'
import { useTranslateEnginesDrawer } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslationPlaySettings } from '@/components/translate/TranslationPlaySettings'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { useAnimatedNumber } from '@/components/translate/useAnimatedNumber'
import { readApiErrorMessage } from '@/lib/api-error'
import { estimateRemainMs, formatRemainEta } from '@/lib/translate/remain-eta'
import { cn } from '@/lib/utils'

type Progress = {
  hasSeed: boolean
  total: number
  done: number
  missing: number
  needCount: number
  skipCount: number
  needChars: number
  skipChars: number
  missingChars: number
  doneChars: number
  lines: number
  batchSize: number
  batchesLeft: number
}

type JobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

type JobState = {
  status: JobStatus
  liveStatus: string
  sessionDone: number
  startedAt: number | null
  error: string | null
  logs: TranslateLogEntry[]
}
type ActivityState = { logs: TranslateLogEntry[]; liveStatus: string; sessionDone: number }

const emptyProgress: Progress = {
  hasSeed: false,
  total: 0,
  done: 0,
  missing: 0,
  needCount: 0,
  skipCount: 0,
  needChars: 0,
  skipChars: 0,
  missingChars: 0,
  doneChars: 0,
  lines: 0,
  batchSize: 40,
  batchesLeft: 0,
}

const emptyJob: JobState = {
  status: 'idle',
  liveStatus: '',
  sessionDone: 0,
  startedAt: null,
  error: null,
  logs: [],
}

const POLL_MS = 1200

function readProgress(json: Partial<Progress>): Progress {
  return {
    hasSeed: !!json.hasSeed,
    total: json.total ?? 0,
    done: json.done ?? 0,
    missing: json.missing ?? 0,
    needCount: json.needCount ?? 0,
    skipCount: json.skipCount ?? 0,
    needChars: json.needChars ?? 0,
    skipChars: json.skipChars ?? 0,
    missingChars: json.missingChars ?? 0,
    doneChars: json.doneChars ?? 0,
    lines: json.lines ?? 0,
    batchSize: json.batchSize ?? 40,
    batchesLeft: json.batchesLeft ?? 0,
  }
}

function readJob(json: Partial<JobState> | undefined): JobState {
  if (!json) return emptyJob
  return {
    status: json.status ?? 'idle',
    liveStatus: json.liveStatus ?? '',
    sessionDone: json.sessionDone ?? 0,
    startedAt: typeof json.startedAt === 'number' ? json.startedAt : null,
    error: json.error ?? null,
    logs: Array.isArray(json.logs) ? json.logs : [],
  }
}

function ProgressMeter({ label, pct, hint, indeterminate = false }: { label: string; pct: number; hint?: string; indeterminate?: boolean }) {
  const animatedPct = useAnimatedNumber(pct, 1500)
  const clamped = Math.min(100, Math.max(0, animatedPct))
  return (
    <div role="progressbar" aria-valuenow={indeterminate ? undefined : clamped} aria-valuemin={0} aria-valuemax={100} aria-busy={indeterminate || undefined} aria-label={label}>
      <div className="mb-2 flex justify-between gap-3 text-[0.75rem] text-ink-soft">
        <TruncateText
          text={
            <>
              {label}
              {hint ? <span className="text-ink-soft/80"> · {hint}</span> : null}
            </>
          }
        />
        <span className="shrink-0 tabular-nums">{indeterminate ? '…' : `${clamped}%`}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-inset">
        {indeterminate ? (
          <div className="h-full w-full animate-pulse rounded-full bg-accent/55" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${clamped}%` }} />
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value, hint, tone = 'ink' }: { label: string; value: number; hint?: ReactNode; tone?: 'ink' | 'ok' | 'warn' | 'accent' }) {
  const animated = useAnimatedNumber(value, 1500)
  const valueTone = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-accent' : 'text-ink'

  return (
    <div className="rounded-[0.3rem] bg-inset/80 px-4 py-3">
      <div className="text-[0.6875rem] font-medium tracking-wide text-ink-soft">{label}</div>
      <div className={cn('mt-2 text-[1.35rem] font-semibold leading-none tabular-nums tracking-tight', valueTone)}>{animated.toLocaleString()}</div>
      {hint ? <div className="mt-2 text-[0.6875rem] leading-snug text-ink-soft/90">{hint}</div> : null}
    </div>
  )
}

/** 翻译页：单卡片展示 seed 进度；补译由游戏后台任务驱动 */
export function TranslateRunPane({
  tab: selectedTab,
  onTabChange,
  surface = 'page',
}: { tab?: 'play' | 'seed'; onTabChange?: (tab: 'play' | 'seed') => void; surface?: 'page' | 'overlay' } = {}) {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const fileRef = useRef<HTMLInputElement>(null)
  const [localTab, setLocalTab] = useState<'play' | 'seed'>('play')
  const tab = selectedTab ?? localTab
  const setTab = onTabChange ?? setLocalTab
  const panelId = useId()
  const tabs = useMemo(
    () => [
      { id: 'play' as const, label: t('translate.playTab'), panelId: `${panelId}-play` },
      { id: 'seed' as const, label: t('translate.seedTab'), panelId: `${panelId}-seed` },
    ],
    [panelId, t]
  )
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [job, setJob] = useState<JobState>(emptyJob)
  const [activity, setActivity] = useState<ActivityState>({ logs: [], liveStatus: '', sessionDone: 0 })
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [enabledEngines, setEnabledEngines] = useState<EngineId[]>(['bing', 'google'])
  const { open: enginesOpen, setOpen: setEnginesOpen } = useTranslateEnginesDrawer()
  const prevStatus = useRef<JobStatus>('idle')

  const running = job.status === 'running'
  const busy = loading || extracting || running || importing || starting || pausing

  const applySnapshot = useCallback((json: Partial<Progress> & { job?: Partial<JobState>; activity?: Partial<ActivityState> }) => {
    setProgress(readProgress(json))
    setJob(readJob(json.job))
    if (json.activity)
      setActivity({ logs: Array.isArray(json.activity.logs) ? json.activity.logs : [], liveStatus: json.activity.liveStatus || '', sessionDone: json.activity.sessionDone || 0 })
    setStatus('')
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'progress' }),
      })
      const json = (await res.json()) as Progress & { ok?: boolean; job?: JobState; activity?: ActivityState; error?: unknown }
      if (!res.ok || json.ok === false) {
        setStatus(readApiErrorMessage(json, t('translate.progressFailed')))
        setProgress(emptyProgress)
        setJob(emptyJob)
        return
      }
      applySnapshot(json)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('translate.progressFailed'))
      setProgress(emptyProgress)
      setJob(emptyJob)
    }
  }, [applySnapshot, t, translationFetch])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      await refresh()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  /** 游戏任务 running 时轮询；离开本页轮询停，任务仍继续 */
  useEffect(() => {
    if (!running && !(surface === 'overlay' && tab === 'play')) return
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [running, refresh, surface, tab])

  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = job.status
    if (prev === 'running' && job.status === 'done') {
      notify.success(job.liveStatus || t('translate.translateDone'))
    } else if (prev === 'running' && job.status === 'paused') {
      notify.info(job.liveStatus || t('translate.translatePaused'))
    } else if (prev === 'running' && job.status === 'error' && job.error) {
      notify.error(job.error)
    }
  }, [job.status, job.liveStatus, job.error, notify, t])

  const onEnginesChange = useCallback((_sw: unknown, enabled: EngineId[]) => {
    setEnabledEngines((prev) => (prev.length === enabled.length && prev.every((id, i) => id === enabled[i]) ? prev : enabled))
  }, [])

  async function runExtract() {
    setExtracting(true)
    try {
      const res = await translationFetch('/api/extract', { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; unique?: number; added?: number; total?: number; error?: unknown }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.extractFailed')))
        return
      }
      await refresh()
      notify.success(json.added ? t('translate.extractDoneAdded', { total: json.total ?? 0, added: json.added }) : t('translate.extractUpToDate', { total: json.total ?? 0 }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.extractFailed'))
    } finally {
      setExtracting(false)
    }
  }

  async function startJob() {
    if (starting || running) return
    const wasPaused = job.status === 'paused'
    setStarting(true)
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'job', action: 'start' }),
      })
      const json = (await res.json()) as Progress & { ok?: boolean; job?: JobState; error?: unknown }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.startFailed')))
        return
      }
      applySnapshot(json)
      if (json.job?.status === 'done') {
        notify.success(json.job.liveStatus || t('translate.completed'))
      } else {
        notify.success(wasPaused ? t('translate.continuedBg') : t('translate.startedBg'))
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.startFailed'))
    } finally {
      setStarting(false)
    }
  }

  async function pauseJob() {
    if (pausing || !running) return
    setPausing(true)
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'job', action: 'pause' }),
      })
      const json = (await res.json()) as Progress & { ok?: boolean; job?: JobState; error?: unknown }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.pauseFailed')))
        return
      }
      applySnapshot(json)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.pauseFailed'))
    } finally {
      setPausing(false)
    }
  }

  async function importFile(file: File) {
    setImporting(true)
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error(t('translate.fileTooLarge'))
      const res = await translationFetch('/api/translate-cache', { method: 'POST', body: JSON.stringify({ text: await file.text(), filename: file.name }) })
      const json = (await res.json()) as {
        ok?: boolean
        inserted?: number
        total?: number
        skippedExisting?: number
        format?: string
        error?: unknown
      }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.importFailed')))
        return
      }
      notify.success(t('translate.importDone', { inserted: json.inserted ?? 0, total: json.total ?? 0 }))
      await refresh()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.importFailed'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const extractPct = progress.hasSeed ? 100 : 0
  const translatePct = progress.needCount > 0 ? Math.min(100, Math.round((progress.done / progress.needCount) * 100)) : progress.hasSeed ? 100 : 0
  const batchesTotal = progress.needCount > 0 ? Math.ceil(progress.needCount / (progress.batchSize || 40)) : 0
  const batchesDone = Math.max(0, batchesTotal - progress.batchesLeft)
  const liveStatus = job.liveStatus || (extracting ? t('translate.extractingText') : '')
  const canStart = progress.missing > 0 && enabledEngines.length > 0
  const startLabel = job.status === 'paused' ? t('translate.continue') : progress.missing > 0 ? t('translate.start') : t('translate.completed')
  const remainMs =
    running || job.status === 'paused'
      ? estimateRemainMs({
          missing: progress.missing,
          sessionDone: job.sessionDone,
          startedAt: job.startedAt,
        })
      : null
  const remainEta = remainMs != null ? formatRemainEta(remainMs) : null
  if (loading) return <TranslateRunSkeleton tab={tab} />

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.ndjson,application/json,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importFile(file)
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-stretch">
          <TranslateEngineRail
            disabled={busy}
            mobileOpen={enginesOpen}
            onMobileOpenChange={setEnginesOpen}
            onChange={onEnginesChange}
            manageAgentsHref={surface === 'page' ? '/settings/agents' : undefined}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-[3.25rem] shrink-0 items-center border-b border-line px-4 py-2">
              <SegmentedNav items={tabs} value={tab} onChange={setTab} aria-label={t('translate.configAria')} />
            </div>
            <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('translate.taskAria') }}>
              <div className="flex items-start justify-start p-4">
                <div className="flex w-full max-w-[32rem] flex-col gap-3">
                  <div role="tabpanel" id={`${panelId}-play`} aria-labelledby={`${panelId}-play-tab`} hidden={tab !== 'play'}>
                    <TranslationPlaySettings />
                    <TranslateActivityLog className="mt-4 w-full" entries={activity.logs} liveStatus={activity.liveStatus} sessionDone={activity.sessionDone} />
                  </div>
                  <div role="tabpanel" id={`${panelId}-seed`} aria-labelledby={`${panelId}-seed-tab`} hidden={tab !== 'seed'}>
                    <div className={cn(formCardDense, 'w-full')}>
                      {status ? (
                        <p role="alert" className="text-fail">
                          {status}
                        </p>
                      ) : null}

                      {!progress.hasSeed ? (
                        <div>
                          <ProgressMeter label={t('translate.extract')} pct={extractPct} indeterminate={extracting} />
                        </div>
                      ) : null}

                      {progress.hasSeed ? (
                        <>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <StatTile
                              label={t('translate.total')}
                              value={progress.total}
                              hint={t('translate.needSkipHint', {
                                need: progress.needCount.toLocaleString(),
                                skip: progress.skipCount.toLocaleString(),
                              })}
                            />
                            <StatTile
                              label={t('translate.translated')}
                              value={progress.done}
                              hint={t('translate.charsHint', { count: progress.doneChars.toLocaleString() })}
                              tone="ok"
                            />
                            <StatTile
                              label={t('translate.missing')}
                              value={progress.missing}
                              hint={t('translate.charsPending', { count: progress.missingChars.toLocaleString() })}
                              tone="warn"
                            />
                            <StatTile
                              label={t('translate.pendingChars')}
                              value={progress.missingChars}
                              hint={t('translate.needCharsHint', { count: progress.needChars.toLocaleString() })}
                              tone="warn"
                            />
                            <StatTile
                              label={t('translate.skipChars')}
                              value={progress.skipChars}
                              hint={t('translate.skipLinesHint', { count: progress.skipCount.toLocaleString() })}
                            />
                            <StatTile
                              label={t('translate.lines')}
                              value={progress.lines}
                              hint={
                                batchesTotal
                                  ? t('translate.batchHint', { done: batchesDone.toLocaleString(), total: batchesTotal.toLocaleString(), size: progress.batchSize })
                                  : t('translate.perBatch', { size: progress.batchSize })
                              }
                              tone="accent"
                            />
                          </div>
                          <div>
                            <ProgressMeter
                              label={t('translate.tabRun')}
                              pct={translatePct}
                              hint={
                                remainEta
                                  ? t('translate.etaLeft', { eta: remainEta })
                                  : running && progress.batchesLeft > 0
                                    ? t('translate.stillMissingNoEta', { count: progress.batchesLeft })
                                    : undefined
                              }
                            />
                          </div>
                        </>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3 [&_button]:min-h-11 [&_button]:min-w-[8.5rem] [&_button]:px-4 [&_button]:py-2 [&_button]:text-[0.9375rem] [&_button]:font-semibold">
                        <Button disabled={busy} loading={importing} onClick={() => fileRef.current?.click()}>
                          <IoCloudUploadOutline size={18} aria-hidden />
                          {t('translate.importFile')}
                        </Button>
                        {progress.hasSeed ? (
                          <Button disabled={busy} loading={extracting} onClick={() => void runExtract()}>
                            <LuScanText size={18} aria-hidden />
                            {t('translate.updateSource')}
                          </Button>
                        ) : null}
                        {!progress.hasSeed ? (
                          <Button variant="ok" disabled={busy} loading={extracting} onClick={() => void runExtract()}>
                            <LuScanText size={18} aria-hidden />
                            {t('translate.extract')}
                          </Button>
                        ) : running ? (
                          <Button variant="fail" disabled={pausing} loading={pausing} onClick={() => void pauseJob()}>
                            <IoPauseOutline size={19} aria-hidden />
                            {t('common.pause')}
                          </Button>
                        ) : (
                          <Button variant="ok" disabled={busy || !canStart} loading={starting} onClick={() => void startJob()}>
                            <IoPlayOutline size={19} aria-hidden />
                            {startLabel}
                          </Button>
                        )}
                      </div>
                    </div>

                    {tab === 'seed' ? <TranslateActivityLog className="mt-4 w-full" entries={job.logs} liveStatus={liveStatus} sessionDone={job.sessionDone} /> : null}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </>
  )
}
