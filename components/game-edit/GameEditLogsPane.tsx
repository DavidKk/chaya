'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IoCheckmark, IoCopyOutline, IoTrashOutline } from 'react-icons/io5'

import { AgentActivityLogPanel } from '@/components/game-agent/AgentActivityLogPanel'
import { AgentCliProcessesPanel } from '@/components/game-agent/AgentCliProcessesPanel'
import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead, panelHeadEnd } from '@/components/layoutClasses'
import { LogEntriesView, matchesLogQuery } from '@/components/LogEntriesView'
import { LogLevelMultiSelect } from '@/components/LogLevelMultiSelect'
import { DEFAULT_LOGS_SECTION, isLogsSection, LOGS_SECTIONS, type LogsSection } from '@/components/logs/sections'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Button, TextInput, Tooltip } from '@/components/sk'
import { LOG_LEVELS, type LogLevel } from '@/lib/log/types'
import { useViewState } from '@/lib/view-state'

type PluginLogEntry = { id: number; ts: number; level: 'ok' | 'info' | 'warn' | 'fail' | 'debug'; source: string; message: string; meta?: unknown }
type LocalLogApi = { history: () => PluginLogEntry[]; subscribe: (listener: () => void) => () => void; clear: () => void }
const EMPTY_LOGS: PluginLogEntry[] = []
const logApi = () => (typeof window === 'undefined' ? undefined : (window as Window & { ChayaLog?: LocalLogApi }).ChayaLog)
const readLogs = (): PluginLogEntry[] => logApi()?.history() ?? EMPTY_LOGS
const subscribeLogs = (listener: () => void) => logApi()?.subscribe(listener) ?? (() => {})
function formatLog(entry: PluginLogEntry): string {
  const meta = entry.meta == null ? '' : typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta)
  return `${new Date(entry.ts).toISOString()} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}${meta ? `\n${meta}` : ''}`
}

/** Logs stay in the game process, so this works even without a Web connection. */
export function GameEditLogsPane({ agentRequest }: { agentRequest?: GameAgentRequest }) {
  const t = useT()
  const [section, setSection] = useViewState<LogsSection>('logs.section', DEFAULT_LOGS_SECTION, isLogsSection)
  const entries = useSyncExternalStore(subscribeLogs, readLogs, () => EMPTY_LOGS)
  const [levelFilter, setLevelFilter] = useState<ReadonlySet<LogLevel>>(() => new Set(LOG_LEVELS))
  const [query, setQuery] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [copyKind, setCopyKind] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [copiedCount, setCopiedCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const needle = query.trim().toLowerCase()
  const visibleEntries = entries.filter((entry) => levelFilter.has(entry.level) && matchesLogQuery(entry, needle))
  const hasFilter = levelFilter.size !== LOG_LEVELS.length || Boolean(needle)
  const lastId = visibleEntries.at(-1)?.id
  const copyStatus = copyKind === 'ok' ? t('logs.copiedN', { count: copiedCount }) : copyKind === 'fail' ? t('logs.copyFailed') : ''
  const active = agentRequest ? section : 'runtime'

  useEffect(() => {
    if (!agentRequest && section !== 'runtime') setSection('runtime')
  }, [agentRequest, section, setSection])

  useEffect(() => {
    if (followRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lastId, levelFilter])

  async function copyVisible() {
    try {
      await navigator.clipboard.writeText(visibleEntries.map(formatLog).join('\n'))
      setCopiedCount(visibleEntries.length)
      setCopyKind('ok')
    } catch {
      setCopyKind('fail')
    }
  }

  function commitQuery(next: string) {
    const value = next.trim()
    setQueryInput(value)
    setQuery(value)
    setCopyKind('idle')
    followRef.current = true
  }

  const subNav = agentRequest ? (
    <SectionSideNav label={t('nav.logs')} mobile>
      {LOGS_SECTIONS.map(({ id, labelKey, icon: Icon }) => {
        const label = t(labelKey)
        const selected = active === id
        return (
          <li key={id}>
            <Tooltip content={label} placement="right">
              <button
                type="button"
                aria-label={label}
                aria-current={selected ? 'page' : undefined}
                className={`${sectionSideNavItemClass(selected)} cursor-pointer`}
                onClick={() => setSection(id)}
              >
                <SectionSideNavItemContent active={selected} icon={<Icon size={16} />} />
              </button>
            </Tooltip>
          </li>
        )
      })}
    </SectionSideNav>
  ) : null

  if (active === 'agent' && agentRequest) {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {subNav}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AgentActivityLogPanel request={agentRequest} onBack={() => setSection('runtime')} />
        </div>
      </div>
    )
  }

  if (active === 'cli' && agentRequest) {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {subNav}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AgentCliProcessesPanel request={agentRequest} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {subNav}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={panelHead}>
          <PanelHeadTitle title={t('logs.region')} description={t('logs.regionDesc')} />
          <div className={panelHeadEnd}>
            <TextInput
              search
              className="w-52 max-w-full shrink"
              value={queryInput}
              placeholder={t('logs.searchPh')}
              aria-label={t('logs.searchAria')}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitQuery(queryInput)
              }}
              onBlur={() => commitQuery(queryInput)}
            />
            <LogLevelMultiSelect
              value={levelFilter}
              onChange={(next) => {
                setLevelFilter(next)
                setCopyKind('idle')
                followRef.current = true
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={!visibleEntries.length}
              aria-label={t('logs.copy')}
              tooltip={copyKind === 'fail' ? t('logs.copyRetry') : copyStatus || t('logs.copy')}
              onClick={() => void copyVisible()}
            >
              {copyKind === 'ok' ? <IoCheckmark size={16} aria-hidden /> : <IoCopyOutline size={16} aria-hidden />}
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('logs.clear')} tooltip={t('logs.clear')} disabled={!entries.length} onClick={() => logApi()?.clear()}>
              <IoTrashOutline size={16} aria-hidden />
            </Button>
          </div>
        </div>
        <span role="status" className="sr-only">
          {copyStatus}
        </span>
        <LogEntriesView
          entries={visibleEntries}
          total={entries.length}
          hasFilter={hasFilter}
          scrollRef={scrollRef}
          ariaLabel={t('logs.overlayAria')}
          onScroll={(element) => {
            followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
          }}
        />
      </div>
    </div>
  )
}
