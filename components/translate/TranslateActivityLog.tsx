'use client'

import { useEffect, useRef } from 'react'

import { formCard, formDesc, formTitle } from '@/components/layoutClasses'
import { ScrollArea } from '@/components/sk'
import { useAnimatedNumber } from '@/components/translate/useAnimatedNumber'
import { cn } from '@/lib/utils'

export type TranslateLogLevel = 'info' | 'ok' | 'warn' | 'fail'

export type TranslateLogEntry = {
  id: number
  at: number
  level: TranslateLogLevel
  text: string
}

function fmtTime(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}

const levelClass: Record<TranslateLogLevel, string> = {
  info: 'text-ink-soft',
  ok: 'text-ok',
  warn: 'text-warn',
  fail: 'text-fail',
}

type Props = {
  entries: TranslateLogEntry[]
  liveStatus?: string
  sessionDone?: number
  className?: string
}

function AnimatedSessionDone({ value }: { value: number }) {
  const n = useAnimatedNumber(value, 1500)
  return <>{n.toLocaleString()}</>
}

/** 翻译会话活动日志：当前状态 + 滚动明细 */
export function TranslateActivityLog({ entries, liveStatus, sessionDone = 0, className }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const latest = entries.at(-1)

  useEffect(() => {
    const viewport = scrollRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [entries.length, latest?.id, latest?.text, liveStatus])

  return (
    <div className={cn(formCard, '[&>*]:px-4 [&>*]:py-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={cn(formTitle, 'm-0 text-[0.8125rem]')}>活动日志</h3>
        <span className="tabular-nums text-[0.7rem] text-ink-soft">
          本会话已译 <AnimatedSessionDone value={sessionDone} /> 条
        </span>
      </div>
      {liveStatus ? (
        <p className={cn(formDesc, 'mt-1.5 animate-pulse text-[0.75rem] text-accent')}>{liveStatus}</p>
      ) : (
        <p className={cn(formDesc, 'mt-1.5')}>开始翻译后显示每段进度与样例。</p>
      )}
      <ScrollArea scrollRef={scrollRef} className="mt-3 h-[11rem]" indicator="vertical" scrollProps={{ 'aria-label': '翻译活动日志', tabIndex: 0 }}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 font-mono text-[0.7rem] leading-relaxed">
          {entries.length === 0 ? (
            <li className="text-ink-soft">暂无记录</li>
          ) : (
            entries.map((entry) => (
              <li key={entry.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-ink-soft/80">{fmtTime(entry.at)}</span>
                <span className={cn('min-w-0 break-all', levelClass[entry.level])}>{entry.text}</span>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
    </div>
  )
}

export function clipLogText(text: string, max = 48): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}
