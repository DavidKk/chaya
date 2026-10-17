'use client'

import { useCallback, useEffect, useState } from 'react'
import { IoRefreshOutline, IoStopCircleOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelBody, panelHead, panelHeadEnd, panelShell } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { Badge, Button, CopyField, EmptyState, ScrollArea, Spinner } from '@/components/sk'
import { cn } from '@/lib/utils'

import type { GameAgentRequest } from './GameAgentWorkspace'

type ProxyReport = {
  vars: Record<string, string>
  slotsFilled: string[]
  slotsMissing: string[]
  complete: boolean
}

type LiveProcess = {
  id: string
  pid: number
  ppid: number | null
  kind: 'stdio' | 'pty' | 'orphan'
  source: 'chaya' | 'system'
  label: string
  file: string
  args: string[]
  command: string
  commandText: string
  envText: string
  cwd: string | null
  startedAt: number | null
  env: Record<string, string>
  envSource: 'spawn' | 'unavailable'
  proxy: ProxyReport
  stats: { cpuPercent: number | null; memoryBytes: number | null; elapsed: string | null }
}

function formatMemory(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatCpu(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function proxyTone(proxy: ProxyReport, envSource: LiveProcess['envSource']): 'ok' | 'warn' | 'neutral' {
  if (envSource === 'unavailable') return 'neutral'
  if (proxy.complete) return 'ok'
  if (proxy.slotsFilled.length) return 'warn'
  return 'neutral'
}

function formatEnvFallback(vars: Record<string, string>) {
  return Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function MetaCopy({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      className="m-0 cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.72rem] text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      title={`${label}: ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          /* ignore — pid copy is best-effort */
        }
      }}
    >
      <span className="text-ink-soft">{label}:</span> {value}
    </button>
  )
}

export function AgentCliProcessesPanel({ request }: { request?: GameAgentRequest }) {
  const t = useT()
  const notify = useNotification()
  const send = useCallback<GameAgentRequest>((path, init) => (request ? request(path, init) : fetch(path, init)), [request])
  const [items, setItems] = useState<LiveProcess[]>([])
  const [loading, setLoading] = useState(true)
  const [killingId, setKillingId] = useState('')
  const [error, setError] = useState('')
  const [at, setAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await send('/api/game-agent/processes', { method: 'GET', cache: 'no-store' })
      const body = (await response.json()) as { processes?: LiveProcess[]; at?: number; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`)
      setItems(body.processes || [])
      setAt(body.at ?? Date.now())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [send])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 3_000)
    return () => clearInterval(timer)
  }, [load])

  const kill = useCallback(
    async (item: LiveProcess) => {
      setKillingId(item.id)
      try {
        const response = await send(`/api/game-agent/processes?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
        if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`)
        notify.success(t('logs.cliKilled', { name: item.label, pid: item.pid }))
        setItems((current) => current.filter((row) => row.id !== item.id))
        void load()
      } catch (cause) {
        notify.error(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setKillingId('')
      }
    },
    [load, notify, send, t]
  )

  return (
    <div className={cn(panelShell, 'flex min-h-0 flex-1 flex-col')}>
      <div className={panelHead}>
        <PanelHeadTitle title={t('logs.cliProcesses')} description={t('logs.cliProcessesDesc')} />
        <div className={panelHeadEnd}>
          {at ? <span className="text-[0.68rem] text-ink-soft">{t('logs.cliRefreshed', { time: new Date(at).toLocaleTimeString() })}</span> : null}
          <Button size="icon" variant="ghost" aria-label={t('logs.cliRefresh')} onClick={() => void load()}>
            {loading && !items.length ? <Spinner size="sm" /> : <IoRefreshOutline size={16} />}
          </Button>
        </div>
      </div>
      {error ? (
        <div className={panelBody}>
          <EmptyState title={t('logs.cliLoadFailed')} message={error} />
        </div>
      ) : !items.length && !loading ? (
        <div className={panelBody}>
          <EmptyState title={t('logs.cliEmptyTitle')} message={t('logs.cliEmptyMsg')} hint={t('logs.cliEmptyHint')} />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-2.5" data-agent-cli-processes>
            {items.map((item) => {
              const tone = proxyTone(item.proxy, item.envSource)
              const proxyLabel =
                item.envSource === 'unavailable'
                  ? t('logs.cliProxyUnknown')
                  : item.proxy.complete
                    ? t('logs.cliProxyComplete')
                    : item.proxy.slotsFilled.length
                      ? t('logs.cliProxyPartial', { missing: item.proxy.slotsMissing.join(', ') })
                      : t('logs.cliProxyNone')
              const envValue = item.envSource === 'unavailable' ? t('logs.cliEnvUnavailable') : item.envText || formatEnvFallback(item.proxy.vars) || t('logs.cliProxyNone')
              return (
                <li key={item.id} className="rounded-md border border-line bg-panel px-2.5 py-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="shrink-0 text-[0.8125rem] font-medium text-ink">{item.label}</span>
                      <Badge tone={item.source === 'chaya' ? 'info' : 'neutral'}>{item.source === 'chaya' ? t('logs.cliSourceChaya') : t('logs.cliSourceSystem')}</Badge>
                      <Badge tone={tone}>{proxyLabel}</Badge>
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <MetaCopy label="pid" value={String(item.pid)} />
                        <span className="font-mono text-[0.72rem] text-ink">
                          <span className="text-ink-soft">cpu:</span> {formatCpu(item.stats.cpuPercent)}
                        </span>
                        <span className="font-mono text-[0.72rem] text-ink">
                          <span className="text-ink-soft">{t('logs.cliMemory').toLowerCase()}:</span> {formatMemory(item.stats.memoryBytes)}
                        </span>
                        {item.stats.elapsed ? (
                          <span className="font-mono text-[0.72rem] text-ink">
                            <span className="text-ink-soft">{t('logs.cliElapsed').toLowerCase()}:</span> {item.stats.elapsed}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <Button
                      size="mini"
                      variant="plain"
                      className="shrink-0 text-fail hover:text-fail"
                      aria-label={t('logs.cliKill')}
                      tooltip={t('logs.cliKill')}
                      loading={killingId === item.id}
                      onClick={() => void kill(item)}
                    >
                      <IoStopCircleOutline size={15} />
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <CopyField
                      value={item.commandText || item.command}
                      label={t('logs.cliCommand')}
                      className="[&_code]:max-h-[3.6rem] [&_code]:overflow-auto [&_code]:py-1.5 [&_code]:text-[0.68rem] [&_code]:leading-[1.2rem]"
                    />
                    <CopyField
                      value={envValue}
                      label={t('logs.cliEnv')}
                      className="[&_code]:max-h-[3.6rem] [&_code]:overflow-auto [&_code]:py-1.5 [&_code]:text-[0.68rem] [&_code]:leading-[1.2rem]"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  )
}
