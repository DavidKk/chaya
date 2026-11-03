'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { LuChevronDown, LuChevronRight, LuCloudUpload, LuCopy, LuTrash2 } from 'react-icons/lu'

import { Badge, Button, ScrollArea } from '@/components/sk'
import { type RemotePlayLogEntry, remotePlayLogger } from '@/lib/runtime/remote-play-logger'

import { copyToClipboard } from './clipboard'

const MAX_VISIBLE_LOGS = 100

export function RemoteLogsPanel() {
  const [logs, setLogs] = useState<RemotePlayLogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'issues' | 'info'>('all')
  const [expandedMetaId, setExpandedMetaId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  // On-demand subscription: only active while RemoteLogsPanel is mounted
  useEffect(() => {
    const unsub = remotePlayLogger.subscribe((all) => {
      setLogs(all.slice(-MAX_VISIBLE_LOGS))
    })
    return () => {
      unsub()
    }
  }, [])

  const showFeedback = (text: string) => {
    setFeedback(text)
    setTimeout(() => {
      setFeedback((cur) => (cur === text ? null : cur))
    }, 2400)
  }

  const filteredLogs = useMemo(() => {
    if (filter === 'issues') {
      return logs.filter((e) => e.level === 'fail' || e.level === 'warn')
    }
    if (filter === 'info') {
      return logs.filter((e) => e.level === 'info' || e.level === 'ok')
    }
    return logs
  }, [logs, filter])

  const issueCount = useMemo(() => logs.filter((e) => e.level === 'fail' || e.level === 'warn').length, [logs])
  const infoCount = useMemo(() => logs.filter((e) => e.level === 'info' || e.level === 'ok').length, [logs])

  const handleCopyLogs = async () => {
    const text = remotePlayLogger.exportAsText()
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      showFeedback('已复制全部日志到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } else {
      showFeedback('复制失败，请手动选取')
    }
  }

  const handleUploadLogs = async () => {
    setSyncing(true)
    const ok = await remotePlayLogger.flush()
    setSyncing(false)
    if (ok) {
      showFeedback('日志已上报至电脑端控制台')
    } else {
      showFeedback('上报未完成，待网络畅通后重试')
    }
  }

  const handleClear = () => {
    remotePlayLogger.clear()
    setLogs([])
    showFeedback('已清空本地日志缓存')
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {feedback ? (
        <div className="mb-2 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-center text-xs font-semibold text-accent animate-in fade-in duration-150">
          {feedback}
        </div>
      ) : null}

      {/* 操作栏与过滤 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1 rounded-[0.25rem] bg-paper-1/80 p-0.5 border border-line/60">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`cursor-pointer rounded-[0.2rem] px-2 py-1 text-xs font-medium transition-colors border-0 ${
              filter === 'all' ? 'bg-paper text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
            }`}
          >
            全部 ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('issues')}
            className={`cursor-pointer rounded-[0.2rem] px-2 py-1 text-xs font-medium transition-colors border-0 ${
              filter === 'issues' ? 'bg-paper text-fail shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
            }`}
          >
            异常 ({issueCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('info')}
            className={`cursor-pointer rounded-[0.2rem] px-2 py-1 text-xs font-medium transition-colors border-0 ${
              filter === 'info' ? 'bg-paper text-accent shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
            }`}
          >
            常规 ({infoCount})
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="default" onClick={handleCopyLogs} tooltip="复制日志文本">
            <LuCopy size={12} className="mr-1 shrink-0" />
            {copied ? '已复制' : '复制'}
          </Button>
          <Button size="xs" variant="default" loading={syncing} onClick={handleUploadLogs} tooltip="立即同步到电脑后台">
            <LuCloudUpload size={12} className="mr-1 shrink-0" />
            上报
          </Button>
          <Button size="icon" variant="ghost" onClick={handleClear} tooltip="清空日志" aria-label="清空日志">
            <LuTrash2 size={13} />
          </Button>
        </div>
      </div>

      {/* 日志列表 */}
      <ScrollArea className="flex-1 min-h-0 rounded-lg border border-line bg-paper-1/40 p-2" indicator="vertical">
        {filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink-soft">暂无符合条件的日志记录</div>
        ) : (
          <div className="space-y-1.5 font-mono text-[11px]">
            {filteredLogs.map((entry) => {
              const d = new Date(entry.ts)
              const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
              const isExpanded = expandedMetaId === entry.id
              return (
                <div key={entry.id} className="border-b border-line/30 pb-1.5 last:border-0 last:pb-0">
                  <div className="flex items-start gap-1.5">
                    <span className="shrink-0 text-[10px] text-ink-soft leading-4">{time}</span>
                    <Badge
                      dot={false}
                      tone={entry.level === 'ok' ? 'ok' : entry.level === 'fail' ? 'fail' : entry.level === 'warn' ? 'warn' : 'neutral'}
                      className="text-[9px] uppercase px-1 py-0.2"
                    >
                      {entry.level}
                    </Badge>
                    <span className="flex-1 text-ink break-words leading-tight">{entry.message}</span>
                    {entry.meta ? (
                      <button
                        type="button"
                        onClick={() => setExpandedMetaId(isExpanded ? null : entry.id)}
                        className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-ink-soft hover:text-ink"
                        aria-label="展开元数据"
                      >
                        {isExpanded ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />}
                      </button>
                    ) : null}
                  </div>
                  {entry.meta && isExpanded ? (
                    <pre className="mt-1 overflow-x-auto rounded bg-paper-2 p-1.5 text-[10px] text-ink-soft whitespace-pre-wrap break-all">
                      {JSON.stringify(entry.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              )
            })}
            <div ref={logEndRef} />
          </div>
        )}
      </ScrollArea>
      <div className="mt-1 shrink-0 text-center text-[10px] text-ink-soft">移动端仅保留最近 100 条；自动定时批量同步至电脑端</div>
    </div>
  )
}
