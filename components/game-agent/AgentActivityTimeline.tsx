'use client'

import { Brain, Check, CircleAlert, Hammer, MessageSquareText } from 'lucide-react'

import type { AgentActivityEvent, AgentThoughtSummary, AgentTokenUsage } from '@/lib/game-agent/activity'
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

export function AgentActivityTimeline({ events, compact = false, showPrompts = false }: { events: readonly AgentActivityEvent[]; compact?: boolean; showPrompts?: boolean }) {
  const visible = events.filter((event) => event.type !== 'phase' && event.type !== 'tool.started' && (showPrompts || event.type !== 'prompt.recorded'))
  if (!visible.length) return <p className="m-0 flex h-full items-center justify-center px-2 py-3 text-center text-xs text-ink-soft">暂无思考过程</p>
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Agent 思考过程" aria-live="polite">
      {visible.map((event) => {
        const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
        if (event.type === 'thought.updated') {
          const text = thoughtText((data.summary || {}) as AgentThoughtSummary)
          return text ? <ActivityRow key={event.seq} icon={<Brain />} text={text} /> : null
        }
        if (event.type === 'tool.started' || event.type === 'tool.completed') {
          const completed = event.type === 'tool.completed'
          const ok = data.ok !== false
          const details = completed ? data.output : data.input
          return (
            <li key={event.seq} className={cn('min-w-0 text-xs', !ok && 'text-fail')}>
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-2 leading-5 text-ink-soft marker:hidden">
                  <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
                    {completed ? ok ? <Check className="size-3.5 text-ok" /> : <CircleAlert className="size-3.5" /> : <Hammer className="size-3.5 text-accent" />}
                  </span>
                  <span>{completed ? (ok ? '已调用' : '调用失败') : '正在调用'}</span>
                  <code className="min-w-0 truncate text-ink">{String(data.name || 'tool')}</code>
                  {completed && Number(data.durationMs) > 0 ? <span className="ml-auto shrink-0 tabular-nums">{Number(data.durationMs)} ms</span> : null}
                </summary>
                {details !== undefined ? (
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-inset p-2 text-[10px] leading-4 text-ink-soft">{json(details)}</pre>
                ) : null}
              </details>
            </li>
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
          if (!response) return usage ? <ActivityRow key={event.seq} icon={<Brain />} text={usage} muted /> : null
          return (
            <li key={event.seq} className="min-w-0 text-xs">
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
            </li>
          )
        }
        if (event.type === 'prompt.recorded') {
          return (
            <li key={event.seq} className="min-w-0 text-xs">
              <details>
                <summary className="cursor-pointer text-ink-soft">{data.role === 'system' ? '系统提示词' : '用户提示词'}</summary>
                <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-2 text-[10px] leading-4 text-ink">{String(data.content || '')}</pre>
              </details>
            </li>
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
      })}
    </ol>
  )
}

function ActivityRow({ icon, text, muted, danger }: { icon: React.ReactNode; text: string; muted?: boolean; danger?: boolean }) {
  return (
    <li className={cn('flex min-w-0 items-start gap-2 text-xs leading-5', danger ? 'text-fail' : muted ? 'text-ink-soft' : 'text-ink')}>
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </li>
  )
}
