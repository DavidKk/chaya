'use client'

import { BellRing, Brain, Check, CircleAlert, Eye, Gift, Hammer, MapPin, MessageSquareText, Route } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AgentActivityEvent, AgentThoughtSummary, AgentTokenUsage } from '@/lib/game-agent/activity'
import { isGameplayActivityType } from '@/lib/game-agent/gameplay-activity'
import { cn } from '@/lib/utils'

function json(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function thoughtText(summary: AgentThoughtSummary) {
  return [summary.observation, summary.decision, summary.plan, summary.result, summary.next].filter(Boolean).join(' ')
}

function usageText(usage: AgentTokenUsage | undefined) {
  if (!usage) return ''
  const values = [usage.input != null ? `输入 ${usage.input}` : '', usage.output != null ? `输出 ${usage.output}` : '', usage.total != null ? `总计 ${usage.total}` : ''].filter(
    Boolean
  )
  return values.length ? `${values.join(' · ')} tokens` : ''
}

function eventData(event: AgentActivityEvent): Record<string, unknown> {
  return event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
}

function actionId(event: AgentActivityEvent) {
  const data = eventData(event)
  return String(data.actionId || data.callId || event.correlation?.actionId || event.correlation?.toolCallId || '')
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} 秒`
  return `${Math.floor(ms / 60_000)} 分 ${((ms % 60_000) / 1000).toFixed(1)} 秒`
}

function activityTiming(events: readonly AgentActivityEvent[]) {
  const durations = new Map<number, number>()
  const matchedModels = new Set<number>()
  const pending = new Map<string, AgentActivityEvent>()
  let modelStart: AgentActivityEvent | undefined
  for (const event of events) {
    const data = eventData(event)
    const id = actionId(event)
    if (event.type === 'tool.started' && id) pending.set(id, event)
    if (event.type === 'model.requested') modelStart = event
    if (event.type.startsWith('task.') || ['turn.completed', 'turn.stopped', 'turn.failed', 'error'].includes(event.type)) {
      pending.clear()
      modelStart = undefined
    }
    if (event.type !== 'tool.completed' && event.type !== 'model.completed') continue
    const start = event.type === 'model.completed' ? modelStart : pending.get(id)
    if (event.type === 'model.completed' && start) matchedModels.add(event.seq)
    const duration =
      typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs >= 0
        ? data.durationMs
        : event.at != null && start?.at != null && event.at >= start.at
          ? event.at - start.at
          : undefined
    if (duration !== undefined) {
      durations.set(event.seq, duration)
      if (event.type === 'model.completed' && start) {
        durations.set(start.seq, duration)
        durations.delete(event.seq)
      }
    }
    if (event.type === 'model.completed') modelStart = undefined
    else pending.delete(id)
  }
  return { durations, pending, modelStart, matchedModels }
}

export function AgentActivityTimeline({
  events,
  compact = false,
  showPrompts = false,
  filter: controlledFilter,
  onFilterChange,
  hideFilter = false,
}: {
  events: readonly AgentActivityEvent[]
  compact?: boolean
  showPrompts?: boolean
  filter?: ActivityFilter
  onFilterChange?: (filter: ActivityFilter) => void
  hideFilter?: boolean
}) {
  const [internalFilter, setInternalFilter] = useState<ActivityFilter>('all')
  const filter = controlledFilter ?? internalFilter
  const setFilter = onFilterChange ?? setInternalFilter
  const timing = activityTiming(events)
  const [now, setNow] = useState(0)
  const running = timing.pending.size > 0 || timing.modelStart !== undefined
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const available = events.filter(
    (event) => event.type !== 'phase' && (event.type !== 'tool.started' || timing.pending.get(actionId(event)) === event) && (showPrompts || event.type !== 'prompt.recorded')
  )
  const visible = available.filter((event) => filter === 'all' || activityCategory(event.type) === filter)
  if (!available.length)
    return (
      <p role="status" className="m-0 flex h-full items-center justify-center px-2 py-3 text-center text-xs text-ink-soft">
        暂无 Agent 过程
      </p>
    )
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {hideFilter ? null : <AgentActivityFilterToolbar value={filter} onChange={setFilter} />}
      {!visible.length ? (
        <p role="status" className="m-0 px-2 py-3 text-center text-xs text-ink-soft">
          当前筛选下暂无记录
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Agent 过程" aria-live="polite">
        {visible.map((event) => {
          const data = eventData(event)
          const content = (() => {
            if (event.type === 'thought.updated') {
              const text = thoughtText((data.summary || {}) as AgentThoughtSummary)
              return text ? <ActivityRow key={event.seq} icon={<Brain />} text={text} /> : null
            }
            if (event.type === 'game.watch.registered') {
              return <ActivityRow key={event.seq} icon={<Eye />} text={`正在等待与当前方案相关的游戏变化（${watchPhaseLabel(String(data.phase || ''))}）。`} muted />
            }
            if (event.type === 'game.watch.paused') {
              return <ActivityRow key={event.seq} icon={<Brain />} text={`当前为${watchPhaseLabel(String(data.phase || ''))}，由 Agent 自主观察和操作，不推送逐帧变化。`} muted />
            }
            if (event.type === 'game.watch.triggered') {
              const changes = Array.isArray(data.changes) ? data.changes : []
              const summary = changes
                .map((change) => {
                  const item = change && typeof change === 'object' ? (change as Record<string, unknown>) : {}
                  return `${watchChangeLabel(String(item.kind || ''))}${item.eventId == null ? '' : ` #${String(item.eventId)}`}`
                })
                .join('、')
              return <GameplayRow key={event.seq} type={event.type} summary={`检测到相关变化${summary ? `：${summary}` : ''}，重新评估方案。`} details={data} />
            }
            if (isGameplayActivityType(event.type)) {
              return <GameplayRow key={event.seq} type={event.type} summary={String(data.summary || event.type)} details={data.details} />
            }
            if (event.type === 'tool.started' || event.type === 'tool.completed') {
              const completed = event.type === 'tool.completed'
              const ok = data.ok !== false
              const details = completed ? data.output : data.input
              return (
                <div key={event.seq} className={cn('min-w-0 text-xs', !ok && 'text-fail')}>
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-2 leading-5 text-ink-soft marker:hidden">
                      <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
                        {completed ? ok ? <Check className="size-3.5 text-ok" /> : <CircleAlert className="size-3.5" /> : <Hammer className="size-3.5 text-accent" />}
                      </span>
                      <span>{completed ? (ok ? '操作详情' : '操作失败') : '正在操作'}</span>
                      <code className="min-w-0 truncate text-ink">{toolLabel(String(data.name || 'tool'))}</code>
                    </summary>
                    {details !== undefined ? (
                      <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-inset p-2 text-[10px] leading-4 text-ink-soft">{json(details)}</pre>
                    ) : null}
                  </details>
                </div>
              )
            }
            if (event.type === 'progress.updated') return <ActivityRow key={event.seq} icon={<MessageSquareText />} text={String(data.summary || '继续运行')} />
            if (event.type === 'model.requested') {
              const count = Number(data.messageCount) || 0
              const chars = Number(data.contextChars) || 0
              const model = typeof data.model === 'string' && data.model ? data.model : '未知模型'
              return <ActivityRow key={event.seq} icon={<Brain />} text={`${model} · 上下文 ${count} 条消息${chars ? ` · ${chars.toLocaleString()} 字符` : ''}`} muted />
            }
            if (event.type === 'model.completed') {
              const usage = usageText(data.usage as AgentTokenUsage | undefined)
              const model = typeof data.model === 'string' && data.model ? data.model : '未知模型'
              const response = [data.thought ? String(data.thought) : '', String(data.text || '')].filter((part) => part.trim()).join('\n\n')
              if (!response) return <ActivityRow key={event.seq} icon={<Brain />} text={`模型返回 · ${model}${usage ? ` · ${usage}` : ''}`} muted />
              return (
                <div key={event.seq} className="min-w-0 text-xs">
                  <details>
                    <summary className="flex cursor-pointer list-none items-start gap-2 leading-5 text-ink-soft marker:hidden">
                      <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
                        <Brain className="size-3.5" />
                      </span>
                      <span className="min-w-0 whitespace-normal break-words">
                        模型返回 · {model}
                        {usage ? <span className="tabular-nums"> · {usage}</span> : null}
                      </span>
                    </summary>
                    <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-2 text-[10px] leading-4 text-ink">{response}</pre>
                  </details>
                </div>
              )
            }
            if (event.type === 'prompt.recorded') {
              return (
                <div key={event.seq} className="min-w-0 text-xs">
                  <details>
                    <summary className="cursor-pointer text-ink-soft">{data.role === 'system' ? '系统提示词' : '用户提示词'}</summary>
                    <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-2 text-[10px] leading-4 text-ink">
                      {String(data.content || '')}
                    </pre>
                  </details>
                </div>
              )
            }
            if (event.type === 'persistence.degraded') return <ActivityRow key={event.seq} icon={<CircleAlert />} text="活动记录未能持久化，本次运行仍会继续。" danger />
            if (event.type.startsWith('task.'))
              return (
                <ActivityRow
                  key={event.seq}
                  icon={<Check />}
                  text={event.type === 'task.stopped' ? '玩家已停止任务' : event.type === 'task.failed' ? `任务失败：${String(data.error || '')}` : '任务已完成'}
                  danger={event.type === 'task.failed'}
                />
              )
            return compact ? null : <ActivityRow key={event.seq} icon={<MessageSquareText />} text={event.type} muted />
          })()
          if (!content) return null
          const duration = timing.durations.get(event.seq)
          const startedAt = typeof data.startedAt === 'number' ? data.startedAt : event.at
          const elapsed = (event.type === 'tool.started' || timing.modelStart === event) && startedAt != null && now >= startedAt ? now - startedAt : undefined
          return (
            <li key={event.seq} className="min-w-0">
              {content}
              <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] leading-4 text-ink-soft tabular-nums">
                {!compact && event.at != null ? (
                  <time dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()}>
                    {new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}
                  </time>
                ) : null}
                {duration !== undefined ? (
                  <span>
                    {event.type === 'model.requested' || event.type === 'model.completed' ? '模型请求耗时' : '工具调用耗时'} {formatDuration(duration)}
                  </span>
                ) : elapsed !== undefined ? (
                  <span>执行中 · 已耗时 {formatDuration(elapsed)}</span>
                ) : event.type === 'tool.completed' || (event.type === 'model.completed' && !timing.matchedModels.has(event.seq)) ? (
                  <span>耗时未记录</span>
                ) : null}
                {event.type === 'model.requested' && typeof data.contextDurationMs === 'number' ? <span>上下文整理 {formatDuration(data.contextDurationMs)}</span> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export type ActivityFilter = 'all' | 'decision' | 'game' | 'operation' | 'performance'

const ACTIVITY_FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'decision', label: '决策' },
  { value: 'game', label: '游戏' },
  { value: 'operation', label: '操作' },
  { value: 'performance', label: '性能' },
]

export function AgentActivityFilterToolbar({ value, onChange }: { value: ActivityFilter; onChange: (filter: ActivityFilter) => void }) {
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto pb-0.5" role="toolbar" aria-label="筛选 Agent 过程">
      {ACTIVITY_FILTERS.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50',
            value === item.value ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-surface text-ink-soft hover:text-ink'
          )}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function activityCategory(type: string): Exclude<ActivityFilter, 'all'> {
  if (type === 'agent.observation' || type === 'agent.decision' || type === 'agent.verification' || type === 'thought.updated') return 'decision'
  if (type.startsWith('game.')) return 'game'
  if (type.startsWith('tool.') || type.startsWith('navigation.')) return 'operation'
  return 'performance'
}

function toolLabel(name: string) {
  return (
    {
      chaya_live_state: '观察当前游戏状态',
      chaya_live_ui: '观察当前界面',
      chaya_live_interact: '前往并互动',
      chaya_live_press: '操作当前界面',
      chaya_live_move_to: '前往目标位置',
    }[name] || name
  )
}

function watchPhaseLabel(phase: string) {
  return (
    {
      map_navigation: '地图寻路',
      map_interaction: '地图互动',
      dialogue: '对话',
      choice: '选项',
      battle: '战斗',
      menu: '菜单',
      transition: '场景切换',
    }[phase] ||
    phase ||
    '当前场景'
  )
}

function watchChangeLabel(kind: string) {
  return (
    {
      scene_changed: '场景变化',
      map_changed: '地图变化',
      battle_started: '进入战斗',
      battle_ended: '战斗结束',
      dialogue_started: '出现对话',
      dialogue_changed: '对话更新',
      choice_opened: '出现选项',
      choice_closed: '选项关闭',
      target_added: '目标出现',
      target_removed: '目标消失',
      target_changed: '目标状态变化',
      route_blocked: '路径受阻',
      player_deviated: '角色偏离路径',
      nearby_event_added: '出现新的可互动目标',
    }[kind] ||
    kind ||
    '游戏状态变化'
  )
}

function GameplayRow({ type, summary, details }: { type: string; summary: string; details?: unknown }) {
  const icon =
    type === 'game.watch.triggered' ? (
      <BellRing />
    ) : type === 'agent.observation' ? (
      <Eye />
    ) : type === 'agent.decision' ? (
      <Brain />
    ) : type === 'navigation.completed' ? (
      <Route />
    ) : type === 'game.dialogue' || type === 'game.choices_shown' || type === 'game.choice_selected' ? (
      <MessageSquareText />
    ) : type === 'game.gold_changed' || type === 'game.inventory_changed' ? (
      <Gift />
    ) : type === 'game.map_changed' ? (
      <MapPin />
    ) : (
      <Check />
    )
  if (details === undefined) return <ActivityRow icon={icon} text={summary} />
  return (
    <div className="min-w-0 text-xs">
      <details>
        <summary className="flex cursor-pointer list-none items-start gap-2 leading-5 text-ink marker:hidden">
          <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5" aria-hidden>
            {icon}
          </span>
          <span className="min-w-0 break-words">{summary}</span>
        </summary>
        <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-inset p-2 text-[10px] leading-4 text-ink-soft">{json(details)}</pre>
      </details>
    </div>
  )
}

function ActivityRow({ icon, text, muted, danger }: { icon: React.ReactNode; text: string; muted?: boolean; danger?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-2 text-xs leading-5', danger ? 'text-fail' : muted ? 'text-ink-soft' : 'text-ink')}>
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  )
}
