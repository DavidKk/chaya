'use client'

import { useEffect, useMemo, useState } from 'react'

import { panelBody, panelHead, panelShell } from '@/components/layoutClasses'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { Button, EmptyState, ScrollArea, Spinner } from '@/components/sk'
import type { AgentTask } from '@/lib/game-agent/runtime'
import { cn } from '@/lib/utils'

import { AgentActivityTimeline } from './AgentActivityTimeline'
import type { GameAgentRequest } from './GameAgentWorkspace'

export function AgentActivityLogPanel({ request, onBack }: { request?: GameAgentRequest; onBack?: () => void }) {
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const response = request ? await request('/api/game-agent/activity', { method: 'GET' }) : await fetch('/api/game-agent/activity', { cache: 'no-store' })
        const body = (await response.json()) as { tasks?: AgentTask[]; error?: { message?: string } }
        if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`)
        if (!live) return
        setTasks(body.tasks || [])
        setSelected((current) => (body.tasks?.some((task) => task.id === current) ? current : body.tasks?.[0]?.id || ''))
        setError('')
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (live) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(load, 2_000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [request])

  const task = useMemo(() => tasks.find((item) => item.id === selected) || null, [selected, tasks])
  return (
    <div className={panelShell} role="region" aria-label="Agent 活动">
      <div className={panelHead}>
        <PanelHeadTitle title="Agent 活动" description="提示词、公开思考摘要、工具调用与模型用量" />
        {onBack ? (
          <Button variant="ghost" size="xs" onClick={onBack}>
            插件日志
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner label="正在加载 Agent 活动" />
        </div>
      ) : error ? (
        <div className={panelBody}>
          <EmptyState title="无法读取 Agent 活动" message={error} />
        </div>
      ) : !tasks.length ? (
        <div className={panelBody}>
          <EmptyState title="暂无 Agent 活动" message="运行一次 Agent 任务后，记录会显示在这里。" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
          <ScrollArea className="min-h-0 border-r border-line max-md:max-h-40 max-md:border-r-0 max-md:border-b" scrollClassName="p-2" reserveGutter={false}>
            <div className="flex flex-col gap-1">
              {tasks.map((item) => (
                <Button
                  key={item.id}
                  variant="plain"
                  className={cn('h-auto min-h-11 justify-start px-2 py-1.5 text-left', item.id === selected && 'bg-inset text-accent')}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{item.goal}</span>
                    <span className="mt-1 block text-[10px] text-ink-soft">
                      {item.state} · {new Date(item.updatedAt).toLocaleString('zh-CN')}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea className="min-h-0" scrollClassName="p-4" reserveGutter={false}>
            {task ? (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                <div>
                  <h2 className="m-0 text-sm text-ink">{task.goal}</h2>
                  <p className="m-0 mt-1 text-xs text-ink-soft">
                    {task.model} · {task.surface || task.capability} · {task.state}
                  </p>
                </div>
                <AgentActivityTimeline events={task.events} showPrompts />
              </div>
            ) : null}
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
