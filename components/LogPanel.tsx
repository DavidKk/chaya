'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { IoPauseOutline, IoPlayOutline, IoTrashOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead, panelHeadEnd, panelShell } from '@/components/layoutClasses'
import { LogEntriesSkeleton, LogEntriesView, matchesLogQuery } from '@/components/LogEntriesView'
import { LogLevelMultiSelect } from '@/components/LogLevelMultiSelect'
import { Badge, Button, TextInput } from '@/components/sk'
import { LOG_LEVELS, type LogEntry, type LogLevel } from '@/lib/log/types'
import { useQueryPatch } from '@/lib/url/use-query-patch'

const ALL_LEVELS = new Set<LogLevel>(LOG_LEVELS)
const LEVEL_SET = new Set<string>(LOG_LEVELS)

function parseLevelFilter(raw: string | null): ReadonlySet<LogLevel> {
  if (raw == null) return new Set(LOG_LEVELS)
  if (raw === '' || raw === 'none') return new Set()
  const next = new Set<LogLevel>()
  for (const part of raw.split(',')) {
    const v = part.trim().toLowerCase()
    if (LEVEL_SET.has(v)) next.add(v as LogLevel)
  }
  return next
}

function encodeLevelFilter(levels: ReadonlySet<LogLevel>): string | null {
  if (levels.size === LOG_LEVELS.length) return null
  if (levels.size === 0) return 'none'
  return LOG_LEVELS.filter((l) => levels.has(l)).join(',')
}

export function LogPanel() {
  const t = useT()
  const { searchParams, replaceQuery } = useQueryPatch()
  const q = searchParams.get('q') ?? ''
  const levelFilter = useMemo(() => parseLevelFilter(searchParams.get('level')), [searchParams])
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [booted, setBooted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [qInput, setQInput] = useState(q)
  const scroller = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    setQInput(q)
  }, [q])

  useEffect(() => {
    const es = new EventSource('/api/logs/stream?backlog=150')
    es.addEventListener('hello', () => {
      setConnected(true)
      setBooted(true)
    })
    es.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as LogEntry
        if (pausedRef.current) return
        setEntries((prev) => {
          const next = [...prev, entry]
          return next.length > 400 ? next.slice(-400) : next
        })
      } catch {
        /* */
      }
    })
    es.onerror = () => {
      setConnected(false)
      setBooted(true)
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (paused) return
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entries, paused])

  async function clearAll() {
    await fetch('/api/logs', { method: 'DELETE' })
    setEntries([])
  }

  function commitQ(next: string) {
    replaceQuery({ q: next.trim() || null })
  }

  function setLevelFilter(next: ReadonlySet<LogLevel>) {
    replaceQuery({ level: encodeLevelFilter(next) })
  }

  const needle = q.trim().toLowerCase()
  const levelNarrowed = levelFilter.size > 0 && levelFilter.size < ALL_LEVELS.size
  const visible = entries.filter((e) => (levelFilter.size === 0 ? false : levelFilter.has(e.level)) && matchesLogQuery(e, needle))
  const hasFilter = levelNarrowed || levelFilter.size === 0 || Boolean(q.trim())

  return (
    <div className={panelShell} role="region" aria-label={t('logs.region')}>
      <div className={panelHead}>
        <div className={panelHeadEnd}>
          <Badge tone={connected ? 'ok' : 'neutral'}>{connected ? t('logs.live') : t('logs.streamDown')}</Badge>
          <TextInput
            search
            className="w-52 max-w-full shrink"
            value={qInput}
            placeholder={t('logs.searchPh')}
            aria-label={t('logs.searchAria')}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitQ(qInput)
            }}
            onBlur={() => commitQ(qInput)}
          />
          <LogLevelMultiSelect value={levelFilter} onChange={setLevelFilter} />
          <Button
            variant="ghost"
            size="icon"
            aria-label={paused ? t('common.resume') : t('common.pause')}
            tooltip={paused ? t('common.resume') : t('common.pause')}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <IoPlayOutline size={16} aria-hidden /> : <IoPauseOutline size={16} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('logs.clear')} tooltip={t('logs.clear')} onClick={() => void clearAll()}>
            <IoTrashOutline size={16} aria-hidden />
          </Button>
        </div>
      </div>

      {!booted ? (
        <LogEntriesSkeleton />
      ) : (
        <LogEntriesView
          entries={visible}
          total={entries.length}
          hasFilter={hasFilter}
          scrollRef={scroller}
          ariaLabel={t('logs.region')}
          status={paused ? t('logs.pausedRecv') : connected ? t('logs.live') : t('logs.connecting')}
        />
      )}
    </div>
  )
}
