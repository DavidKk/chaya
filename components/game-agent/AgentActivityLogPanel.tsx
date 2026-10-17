'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IoCloseOutline, IoTrashOutline } from 'react-icons/io5'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { panelBody, panelHead, panelShell } from '@/components/layoutClasses'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { Button, EmptyState, ScrollArea, Spinner, TextInput } from '@/components/sk'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentTraceSummary } from '@/lib/game-agent/trace'
import { cn } from '@/lib/utils'

import { type ActivityFilter, AgentActivityFilterToolbar, AgentActivityTimeline } from './AgentActivityTimeline'
import type { GameAgentRequest } from './GameAgentWorkspace'

function includes(value: unknown, query: string) {
  if (!query) return true
  try {
    return JSON.stringify(value).toLocaleLowerCase().includes(query)
  } catch {
    return String(value).toLocaleLowerCase().includes(query)
  }
}

function taskMatches(task: AgentTraceSummary, query: string) {
  return includes([task.goal, task.model, task.state, task.capability, task.surface, task.gameId], query)
}

function sameSummaryList(left: AgentTraceSummary[], right: AgentTraceSummary[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const next = right[index]
      return next && item.id === next.id && item.updatedAt === next.updatedAt && item.eventCount === next.eventCount && item.state === next.state
    })
  )
}

function eventMatches(event: AgentTaskEvent, query: string) {
  return includes([event.type, event.data], query)
}

function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get('Content-Disposition') || ''
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback
}

export function AgentActivityLogPanel({
  request,
  onBack,
  selection = '',
  onSelectionChange,
}: {
  request?: GameAgentRequest
  onBack?: () => void
  selection?: string
  onSelectionChange?: (taskId: string) => void
}) {
  const [summaries, setSummaries] = useState<AgentTraceSummary[]>([])
  const [selected, setSelected] = useState(selection)
  const [task, setTask] = useState<AgentTask | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingTask, setLoadingTask] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const loadedTaskId = useRef('')
  const selectedRef = useRef(selection)
  const confirm = useConfirm()
  const send = useCallback<GameAgentRequest>((path, init) => (request ? request(path, init) : fetch(path, init)), [request])

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const response = await send('/api/game-agent/activity', { method: 'GET', cache: 'no-store' })
        const body = (await response.json()) as { tasks?: AgentTraceSummary[]; error?: { message?: string } }
        if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`)
        if (!live) return
        const next = body.tasks || []
        setSummaries((current) => (sameSummaryList(current, next) ? current : next))
        const current = selectedRef.current
        const nextSelected = next.some((item) => item.id === selection) ? selection : next.some((item) => item.id === current) ? current : next[0]?.id || ''
        selectedRef.current = nextSelected
        setSelected(nextSelected)
        if (nextSelected !== selection) onSelectionChange?.(nextSelected)
        setError('')
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (live) setLoadingList(false)
      }
    }
    void load()
    const timer = window.setInterval(load, 2_000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [onSelectionChange, selection, send])

  useEffect(() => {
    if (selection && summaries.some((item) => item.id === selection)) setSelected(selection)
  }, [selection, summaries])

  const selectTask = (taskId: string) => {
    setSelected(taskId)
    onSelectionChange?.(taskId)
  }

  const selectedSummary = summaries.find((item) => item.id === selected)
  const selectedTaskId = selectedSummary?.id || ''
  const selectedGameId = selectedSummary?.gameId || ''
  const selectedUpdatedAt = selectedSummary?.updatedAt || 0
  const selectedEventCount = selectedSummary?.eventCount || 0

  useEffect(() => {
    let live = true
    if (!selectedTaskId || !selectedGameId) {
      loadedTaskId.current = ''
      setTask(null)
      return () => {
        live = false
      }
    }
    const foreground = loadedTaskId.current !== selectedTaskId
    if (foreground) setLoadingTask(true)
    void send(`/api/game-agent/activity?gameId=${encodeURIComponent(selectedGameId)}&taskId=${encodeURIComponent(selectedTaskId)}`, {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = (await response.json()) as { task?: AgentTask; error?: { message?: string } }
        if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`)
        if (live) {
          loadedTaskId.current = selectedTaskId
          setTask(body.task || null)
          setActionError('')
        }
      })
      .catch((cause) => {
        if (live) setActionError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (live && foreground) setLoadingTask(false)
      })
    return () => {
      live = false
    }
  }, [selectedEventCount, selectedGameId, selectedTaskId, selectedUpdatedAt, send])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleEvents = useMemo(() => (task?.events || []).filter((event) => eventMatches(event, normalizedQuery)), [normalizedQuery, task?.events])
  const visibleSummaries = useMemo(() => {
    if (!normalizedQuery) return summaries
    const result = summaries.filter((item) => taskMatches(item, normalizedQuery))
    if (selectedSummary && visibleEvents.length && !result.some((item) => item.id === selectedSummary.id)) result.unshift(selectedSummary)
    return result
  }, [normalizedQuery, selectedSummary, summaries, visibleEvents.length])

  const exportTask = async () => {
    if (!selectedSummary) return
    setExporting(true)
    setActionError('')
    try {
      const response = await send(`/api/game-agent/activity?gameId=${encodeURIComponent(selectedSummary.gameId)}&taskId=${encodeURIComponent(selectedSummary.id)}&format=jsonl`, {
        method: 'GET',
        cache: 'no-store',
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message || `HTTP ${response.status}`)
      }
      const href = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = href
      link.download = responseFilename(response, `agent-trace-${selectedSummary.id}.jsonl`)
      link.click()
      URL.revokeObjectURL(href)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setExporting(false)
    }
  }

  const removeTask = async (item: AgentTraceSummary) => {
    if (
      !(await confirm({
        title: '删除这条 Agent 轨迹？',
        description: '这会删除该任务的长期记录，不能恢复；不会影响游戏存档或当前任务。',
        confirmLabel: '删除轨迹',
        confirmVariant: 'fail',
      }))
    )
      return
    setActionError('')
    try {
      const response = await send(`/api/game-agent/activity?gameId=${encodeURIComponent(item.gameId)}&taskId=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSummaries((current) => current.filter((candidate) => candidate.id !== item.id))
      if (selected === item.id) {
        setSelected('')
        onSelectionChange?.('')
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const removeAll = async () => {
    if (
      !(await confirm({
        title: '清空全部 Agent 轨迹？',
        description: '这会删除所有游戏中的长期 Agent 记录，不能恢复；不会影响游戏存档或当前任务。',
        confirmLabel: '清空全部轨迹',
        confirmVariant: 'fail',
      }))
    )
      return
    setActionError('')
    try {
      const response = await send('/api/game-agent/activity', { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSummaries([])
      setSelected('')
      onSelectionChange?.('')
      loadedTaskId.current = ''
      setTask(null)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className={panelShell} role="region" aria-label="Agent 活动">
      <div className={panelHead}>
        <PanelHeadTitle title="Agent 活动" description="观察、公开决策、游戏反馈、工具调用与模型用量" />
        {summaries.length ? (
          <div className="ml-auto flex w-[min(28rem,48vw)] min-w-0 shrink items-center gap-1">
            <TextInput
              type="search"
              search
              fullWidth
              aria-label="搜索 Agent 活动"
              placeholder="搜索任务、事件或内容"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <Button variant="plain" size="mini" aria-label="清除搜索" tooltip="清除搜索" onClick={() => setQuery('')}>
                <IoCloseOutline size={15} aria-hidden />
              </Button>
            ) : null}
            <Button variant="plain" size="icon" aria-label="清空全部 Agent 轨迹" tooltip="清空全部 Agent 轨迹" onClick={() => void removeAll()}>
              <IoTrashOutline size={16} aria-hidden />
            </Button>
          </div>
        ) : null}
        {onBack ? (
          <Button variant="ghost" size="xs" onClick={onBack}>
            插件日志
          </Button>
        ) : null}
      </div>
      {loadingList ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner label="正在加载 Agent 活动" />
        </div>
      ) : error && !summaries.length ? (
        <div className={panelBody}>
          <EmptyState title="无法读取 Agent 活动" message={error} />
        </div>
      ) : !summaries.length ? (
        <div className={panelBody}>
          <EmptyState title="暂无 Agent 活动" message="运行一次 Agent 任务后，记录会显示在这里。" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {!visibleSummaries.length ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="status">
              <p className="m-0 text-sm text-ink">没有匹配的 Agent 活动</p>
              <Button size="xs" variant="ghost" onClick={() => setQuery('')}>
                清除搜索
              </Button>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
              <ScrollArea className="min-h-0 border-r border-line max-md:max-h-40 max-md:border-r-0 max-md:border-b" scrollClassName="p-2" reserveGutter={false}>
                <div className="flex flex-col gap-1">
                  {visibleSummaries.map((item) => (
                    <div
                      key={item.id}
                      className={cn('group flex min-w-0 items-stretch rounded-[0.2rem] transition-colors hover:bg-inset focus-within:bg-inset', item.id === selected && 'bg-inset')}
                    >
                      <Button
                        variant="plain"
                        className="h-auto min-h-11 min-w-0 flex-1 justify-start bg-transparent px-2 py-1.5 text-left hover:enabled:bg-transparent"
                        onClick={() => selectTask(item.id)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{item.goal}</span>
                          <span className="mt-1 block text-[10px] text-ink-soft">
                            {item.state} · {item.eventCount} 条 · {new Date(item.updatedAt).toLocaleString('zh-CN')}
                          </span>
                        </span>
                      </Button>
                      <Button
                        variant="plain"
                        size="mini"
                        aria-label="删除轨迹"
                        tooltip="删除轨迹"
                        className="my-1 mr-1 self-center bg-transparent hover:enabled:bg-transparent"
                        onClick={() => void removeTask(item)}
                      >
                        <IoTrashOutline className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex min-h-0 flex-col">
                {selectedSummary ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="m-0 truncate text-sm text-ink">{selectedSummary.goal}</h2>
                      <p className="m-0 mt-1 text-xs text-ink-soft">
                        {selectedSummary.model} · {selectedSummary.surface || selectedSummary.capability} · {selectedSummary.state}
                      </p>
                    </div>
                    <Button size="xs" variant="ghost" loading={exporting} onClick={() => void exportTask()}>
                      导出 JSONL
                    </Button>
                    <AgentActivityFilterToolbar value={filter} onChange={setFilter} />
                  </div>
                ) : null}
                {actionError ? (
                  <p className="m-0 shrink-0 border-b border-fail/30 bg-fail/10 px-4 py-2 text-xs text-fail" role="alert">
                    {actionError}
                  </p>
                ) : null}
                {loadingTask ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Spinner label="正在加载任务轨迹" />
                  </div>
                ) : normalizedQuery && !visibleEvents.length ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="status">
                    <p className="m-0 text-sm text-ink">当前任务中没有匹配事件</p>
                    <Button size="xs" variant="ghost" onClick={() => setQuery('')}>
                      清除搜索
                    </Button>
                  </div>
                ) : (
                  <ScrollArea className="min-h-0" scrollClassName="p-4" reserveGutter={false}>
                    {task ? (
                      <div className="mx-auto w-full max-w-4xl">
                        <AgentActivityTimeline events={visibleEvents} showPrompts filter={filter} onFilterChange={setFilter} hideFilter />
                      </div>
                    ) : null}
                  </ScrollArea>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
