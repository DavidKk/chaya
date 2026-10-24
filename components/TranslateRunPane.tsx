'use client'

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { IoCloudUploadOutline, IoPauseOutline, IoPlayOutline } from 'react-icons/io5'
import { LuScanText } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, ScrollArea, TruncateText } from '@/components/sk'
import type { TranslateRunMode } from '@/components/translate/tabs'
import { TranslateActivityLog, type TranslateLogEntry } from '@/components/translate/TranslateActivityLog'
import { TranslateExportMenu } from '@/components/translate/TranslateExportMenu'
import { TranslateListContent } from '@/components/translate/TranslateListContent'
import { TranslateRgssPreviewSwitch } from '@/components/translate/TranslateRgssPreviewSwitch'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslationPlaySettings } from '@/components/translate/TranslationPlaySettings'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { useAnimatedNumber } from '@/components/translate/useAnimatedNumber'
import { useOptimizeNames } from '@/components/translate/useOptimizeNames'
import { useSyncNames } from '@/components/translate/useSyncNames'
import { readApiErrorMessage } from '@/lib/api-error'
import { filterTranslationExport, type TranslationExportMode } from '@/lib/translate/export'
import { estimateRemainMs, formatRemainEta, type TranslationPerformance } from '@/lib/translate/remain-eta'
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
  preparing?: boolean
}

type JobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

type JobState = {
  performance: TranslationPerformance | null
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
  performance: null,
  liveStatus: '',
  sessionDone: 0,
  startedAt: null,
  error: null,
  logs: [],
}

const POLL_MS = 1200

function readProgress(json: Partial<Progress> & { preparing?: boolean }): Progress {
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
    preparing: json.preparing === true ? true : undefined,
  }
}

function readJob(json: Partial<JobState> | undefined): JobState {
  if (!json) return emptyJob
  return {
    performance: json.performance ?? null,
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
}: { tab?: TranslateRunMode; onTabChange?: (tab: TranslateRunMode) => void; surface?: 'page' | 'overlay' } = {}) {
  const t = useT()
  const panelId = useId()
  const translationFetch = useTranslationFetch()
  const { running: optimizingNames, runOptimizeNames } = useOptimizeNames()
  const { running: syncingNames, runSyncNames } = useSyncNames()
  const notify = useNotification()
  const fileRef = useRef<HTMLInputElement>(null)
  const [localTab, setLocalTab] = useState<TranslateRunMode>('seed')
  const tab = selectedTab ?? localTab
  const setTab = onTabChange ?? setLocalTab
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [job, setJob] = useState<JobState>(emptyJob)
  const [activity, setActivity] = useState<ActivityState>({ logs: [], liveStatus: '', sessionDone: 0 })
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const prevStatus = useRef<JobStatus>('idle')

  const running = job.status === 'running'
  const preparing = progress.preparing === true
  const busy = loading || extracting || running || importing || exporting || starting || pausing || preparing

  const applySnapshot = useCallback((json: Partial<Progress> & { job?: Partial<JobState>; activity?: Partial<ActivityState>; preparing?: boolean }) => {
    setProgress(readProgress(json))
    setJob(readJob(json.job))
    if (json.activity)
      setActivity({ logs: Array.isArray(json.activity.logs) ? json.activity.logs : [], liveStatus: json.activity.liveStatus || '', sessionDone: json.activity.sessionDone || 0 })
    setStatus('')
  }, [])

  const refreshing = useRef(false)
  /** Polls are snapshot-only. Pass `rescan` after extract/import; start path rescans on the server. */
  const refresh = useCallback(
    async (opts?: { rescan?: boolean }) => {
      if (refreshing.current) return
      refreshing.current = true
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'progress', ...(opts?.rescan ? { refresh: true } : {}) }),
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
      } finally {
        refreshing.current = false
      }
    },
    [applySnapshot, t, translationFetch]
  )

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

  /** Poll while running or preparing; polling stops when leaving this view, while the task continues in background */
  useEffect(() => {
    if (!running && !preparing && !(surface === 'overlay' && tab === 'play')) return
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [running, preparing, refresh, surface, tab])

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

  async function runExtract() {
    setExtracting(true)
    try {
      const res = await translationFetch('/api/extract', { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; unique?: number; added?: number; total?: number; error?: unknown }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.extractFailed')))
        return
      }
      await refresh({ rescan: true })
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

  function downloadTranslationJson(entries: Record<string, string>, mode: TranslationExportMode) {
    const blob = new Blob([`${JSON.stringify(entries, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = mode === 'all' ? 'translation.json' : 'translation-untranslated.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function exportJson(mode: TranslationExportMode) {
    setExporting(true)
    try {
      const res = await translationFetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ export: true }),
      })
      const json = (await res.json()) as { ok?: boolean; total?: number; entries?: Record<string, string>; error?: unknown }
      if (!res.ok || json.ok === false || !json.entries || typeof json.entries !== 'object') {
        notify.error(readApiErrorMessage(json, t('translate.exportJsonFailed')))
        return
      }
      const entries = filterTranslationExport(json.entries, mode)
      const total = Object.keys(entries).length
      if (!total) {
        notify.info(t(mode === 'untranslated' ? 'translate.exportUntranslatedEmpty' : 'translate.exportJsonEmpty'))
        return
      }
      downloadTranslationJson(entries, mode)
      await refresh()
      notify.success(t('translate.exportJsonDone', { total }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.exportJsonFailed'))
    } finally {
      setExporting(false)
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
      await refresh({ rescan: true })
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
  const liveStatus = job.liveStatus || (extracting ? t('translate.extractingText') : preparing ? t('translate.preparingInventory') : '')
  const canStart = progress.missing > 0 && !preparing
  const startLabel = job.status === 'paused' ? t('translate.continue') : progress.missing > 0 ? t('translate.start') : t('translate.completed')
  const perf = running && !pausing && job.performance && job.performance.charsPerSecond > 0 ? job.performance : null
  const remainMs = estimateRemainMs({ missingChars: progress.missingChars, charsPerSecond: perf?.charsPerSecond, running })
  const statusHint =
    [
      preparing ? t('translate.preparingInventory') : null,
      remainMs != null ? t('translate.etaLeft', { eta: formatRemainEta(remainMs) }) : null,
      perf ? t('translate.rateCompact', { rate: perf.charsPerSecond.toFixed(1) }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined
  // First paint: show shell skeleton only when we have nothing to show yet.
  // Once a checkpoint exists, keep the page interactive while polls/prepare finish.
  if (loading && !progress.hasSeed && job.status === 'idle') return <TranslateRunSkeleton tab={tab} />

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
        {tab === 'list' ? (
          <div role="tabpanel" id={`${panelId}-list`} aria-labelledby={`${panelId}-list-tab`} data-translate-mode="list" className="flex min-h-0 flex-1 flex-col">
            <TranslateListContent onExtract={() => setTab('seed')} />
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('translate.taskAria') }}>
            <div className="flex items-start justify-start p-4">
              <div className="flex w-full max-w-[52rem] flex-col gap-3">
                <div role="tabpanel" id={`${panelId}-play`} aria-labelledby={`${panelId}-play-tab`} data-translate-mode="play" hidden={tab !== 'play'}>
                  <TranslationPlaySettings />
                  <TranslateActivityLog className="mt-4 w-full" entries={activity.logs} liveStatus={activity.liveStatus} sessionDone={activity.sessionDone} />
                </div>
                <div role="tabpanel" id={`${panelId}-seed`} aria-labelledby={`${panelId}-seed-tab`} data-translate-mode="seed" hidden={tab !== 'seed'}>
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
                        <TranslateRgssPreviewSwitch />
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
                          <ProgressMeter label={t('translate.tabRun')} pct={translatePct} hint={statusHint} />
                        </div>
                      </>
                    ) : null}

                    <div className="grid grid-flow-col auto-cols-fr items-center gap-1 sm:gap-2 [&_svg]:max-sm:hidden [&_button]:max-sm:text-xs [&_button]:w-full [&_button]:min-w-0 [&_button]:gap-1 [&_button]:px-2 [&_button]:whitespace-nowrap">
                      <Button disabled={busy} loading={importing} onClick={() => fileRef.current?.click()}>
                        <IoCloudUploadOutline size={16} aria-hidden />
                        {t('translate.importFile')}
                      </Button>
                      <TranslateExportMenu disabled={busy} loading={exporting} onExport={(mode) => void exportJson(mode)} />
                      {progress.hasSeed ? (
                        <Button
                          variant="ghost"
                          disabled={busy || optimizingNames}
                          loading={optimizingNames}
                          onClick={() => void runOptimizeNames()}
                          tooltip={optimizingNames ? t('translate.optimizeNamesRunning') : t('translate.optimizeNamesTooltip')}
                        >
                          {t('translate.optimizeNames')}
                        </Button>
                      ) : null}
                      {progress.hasSeed ? (
                        <Button
                          variant="ghost"
                          disabled={busy || syncingNames}
                          loading={syncingNames}
                          onClick={() => void runSyncNames()}
                          tooltip={syncingNames ? t('translate.syncNamesRunning') : t('translate.syncNamesTooltip')}
                        >
                          {t('translate.syncNames')}
                        </Button>
                      ) : null}
                      {progress.hasSeed ? (
                        <Button variant="accent" disabled={busy} loading={extracting} onClick={() => void runExtract()}>
                          <LuScanText size={16} aria-hidden />
                          {t('translate.updateSource')}
                        </Button>
                      ) : null}
                      {!progress.hasSeed ? (
                        <Button variant="ok" disabled={busy} loading={extracting} onClick={() => void runExtract()}>
                          <LuScanText size={16} aria-hidden />
                          {t('translate.extract')}
                        </Button>
                      ) : running ? (
                        <Button variant="fail" disabled={pausing} loading={pausing} onClick={() => void pauseJob()}>
                          <IoPauseOutline size={16} aria-hidden />
                          {t('common.pause')}
                        </Button>
                      ) : (
                        <Button variant="ok" disabled={busy || !canStart} loading={starting} onClick={() => void startJob()}>
                          <IoPlayOutline size={16} aria-hidden />
                          {startLabel}
                        </Button>
                      )}
                    </div>
                  </div>

                  <TranslateActivityLog className="mt-4 w-full" entries={job.logs} liveStatus={liveStatus} sessionDone={job.sessionDone} />
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </>
  )
}
