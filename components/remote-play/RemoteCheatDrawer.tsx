'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCloudUpload,
  LuCopy,
  LuFootprints,
  LuHeart,
  LuMonitor,
  LuRotateCw,
  LuSave,
  LuScrollText,
  LuShield,
  LuSlidersHorizontal,
  LuSwords,
  LuTrash2,
  LuX,
  LuZap,
} from 'react-icons/lu'

import type { GameEditCmd, GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { type RemotePlayLogEntry, remotePlayLogger } from '@/lib/runtime/remote-play-logger'

type RemoteCheatDrawerProps = {
  open: boolean
  onClose: () => void
  onSend: (msg: GameLinkMessage) => void
  gameId: string
  initialTab?: 'cheat' | 'logs'
  status?: 'connecting' | 'connected' | 'disconnected'
  latencyMs?: number | null
  videoResolution?: { width: number; height: number } | null
}

function generateCmdId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function generateSaveReqId(): string {
  return `save_${Date.now()}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fallback */
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.top = '0'
      el.style.left = '0'
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      document.body.appendChild(el)
      el.focus()
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }
  return false
}

export function RemoteCheatDrawer({
  open,
  onClose,
  onSend,
  gameId,
  initialTab = 'cheat',
  status = 'connecting',
  latencyMs,
  videoResolution,
}: RemoteCheatDrawerProps) {
  const [activeTab, setActiveTab] = useState<'cheat' | 'logs'>(initialTab)
  const [godMode, setGodMode] = useState(false)
  const [throughWalls, setThroughWalls] = useState(false)
  const [autoWin, setAutoWin] = useState(false)
  const [gameSpeed, setGameSpeed] = useState<number>(1)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [logs, setLogs] = useState<RemotePlayLogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'issues' | 'info'>('all')
  const [expandedMetaId, setExpandedMetaId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  useEffect(() => {
    const unsub = remotePlayLogger.subscribe((next) => {
      setLogs(next)
    })
    return unsub
  }, [])

  const diagnostics = useMemo(() => remotePlayLogger.getDiagnostics(), [])

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

  const handleCopyLogs = async () => {
    const text = remotePlayLogger.exportAsText()
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      showFeedback('已复制诊断日志到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } else {
      showFeedback('复制失败，请手动长按选取')
    }
  }

  const handleUploadLogs = async () => {
    setSyncing(true)
    const ok = await remotePlayLogger.flush()
    setSyncing(false)
    if (ok) {
      setSynced(true)
      showFeedback('日志已上报至电脑端控制台')
      setTimeout(() => setSynced(false), 2000)
    } else {
      showFeedback('上报未完成，待网络畅通后重试')
    }
  }

  const showFeedback = (text: string) => {
    setFeedback(text)
    setTimeout(() => setFeedback(null), 1800)
  }

  const sendCmd = (op: Record<string, unknown>) => {
    const cmdId = generateCmdId()
    onSend({
      type: 'edit.cmd',
      cmdId,
      ...op,
    } as GameEditCmd)
  }

  const handleAddGold = (amount: number) => {
    sendCmd({ op: 'gold', value: amount })
    showFeedback(`已发送增加金币: +${amount}`)
  }

  const handleMaxGold = () => {
    sendCmd({ op: 'gold', value: 9999999 })
    showFeedback('已将金币拉满: 9,999,999')
  }

  const handleToggleGod = () => {
    const next = !godMode
    setGodMode(next)
    sendCmd({ op: 'runFlag', key: 'god', value: next })
    showFeedback(next ? '已开启无敌锁血' : '已关闭无敌锁血')
  }

  const handleToggleThrough = () => {
    const next = !throughWalls
    setThroughWalls(next)
    sendCmd({ op: 'runFlag', key: 'throughWalls', value: next })
    showFeedback(next ? '已开启穿墙模式' : '已关闭穿墙模式')
  }

  const handleToggleAutoWin = () => {
    const next = !autoWin
    setAutoWin(next)
    sendCmd({ op: 'runFlag', key: 'autoWin', value: next })
    showFeedback(next ? '已开启遇敌必胜' : '已关闭遇敌必胜')
  }

  const handleChangeSpeed = (speed: number) => {
    setGameSpeed(speed)
    sendCmd({ op: 'gameSpeed', value: speed })
    showFeedback(`游戏倍速已设为: ${speed}x`)
  }

  const handleFullRecovery = () => {
    // Revive and recover all actors 1..10
    for (let id = 1; id <= 8; id++) {
      sendCmd({ op: 'actorRevive', actorId: id })
      sendCmd({ op: 'actorRecover', actorId: id })
    }
    showFeedback('全员满血满蓝复活')
  }

  const handleQuickSave = () => {
    const reqId = generateSaveReqId()
    onSend({
      type: 'saves.cmd',
      reqId,
      gameId,
      target: 'quick',
      op: 'save',
      slot: 1,
    })
    showFeedback('已请求快速存档到 1 号槽')
  }

  const handleTogglePcUi = () => {
    onSend({ type: 'overlay.open', open: true })
    showFeedback('已请求在电脑端弹出插件面板')
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-sm flex-col border-l border-neutral-700/60 bg-neutral-900/95 p-5 text-neutral-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center space-x-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              {activeTab === 'cheat' ? <LuZap size={16} /> : <LuScrollText size={16} />}
            </div>
            <h2 className="text-base font-bold text-white">Chaya 局内控制台</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="关闭"
          >
            <LuX size={18} />
          </button>
        </div>

        {/* Tab switch */}
        <div className="mt-3 flex rounded-lg bg-neutral-950 p-1 border border-neutral-800">
          <button
            type="button"
            onClick={() => setActiveTab('cheat')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'cheat'
                ? 'bg-neutral-800 text-emerald-400 shadow-sm border border-emerald-500/30'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <LuSlidersHorizontal size={13} />
            常用修改
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'logs'
                ? 'bg-neutral-800 text-sky-400 shadow-sm border border-sky-500/30'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <LuScrollText size={13} />
            诊断日志
            {issueCount > 0 && (
              <span className="ml-1 rounded-full bg-rose-500/80 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {issueCount}
              </span>
            )}
          </button>
        </div>

        {/* Feedback toast */}
        {feedback && <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-3 py-2 text-center text-xs font-semibold text-emerald-300">{feedback}</div>}

        {/* Body scroll area */}
        {activeTab === 'logs' ? (
          <div className="flex-1 flex flex-col min-h-0 pt-3 pb-2 space-y-3">
            {/* Summary card */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-neutral-300">
                <span className="text-neutral-400">链路状态</span>
                <span className="flex items-center gap-1.5 font-medium">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500'
                    }`}
                  />
                  {status === 'connected' ? '已串流连接' : status === 'connecting' ? '握手连接中…' : '链路未就绪'}
                  {latencyMs != null && status === 'connected' && (
                    <span className="font-mono text-emerald-400 text-[11px] ml-1">({latencyMs} ms)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between text-neutral-300">
                <span className="text-neutral-400">视频画幅</span>
                <span className="font-mono text-neutral-200">
                  {videoResolution ? `${videoResolution.width} × ${videoResolution.height}` : '等待解码'}
                </span>
              </div>
              <div className="flex items-center justify-between text-neutral-300">
                <span className="text-neutral-400">客户端环境</span>
                <span className="text-neutral-300 truncate max-w-[190px]" title={diagnostics.userAgent}>
                  {diagnostics.os} / {diagnostics.browser}
                </span>
              </div>
              <div className="flex items-center justify-between text-neutral-300">
                <span className="text-neutral-400">H.264 解码</span>
                <span className={diagnostics.h264Supported ? 'text-emerald-400' : 'text-neutral-400'}>
                  {diagnostics.h264Supported ? '硬件加速支持' : '回退/未知'}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyLogs}
                className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800/80 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700 active:scale-95"
              >
                {copied ? <LuCheck size={13} className="text-emerald-400" /> : <LuCopy size={13} />}
                {copied ? '已复制' : '复制日志'}
              </button>
              <button
                type="button"
                onClick={handleUploadLogs}
                disabled={syncing}
                className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-sky-500/40 bg-sky-950/40 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/60 active:scale-95 disabled:opacity-50"
              >
                {syncing ? <LuRotateCw size={13} className="animate-spin text-sky-300" /> : synced ? <LuCheck size={13} className="text-emerald-400" /> : <LuCloudUpload size={13} />}
                {syncing ? '上报中…' : synced ? '已上报' : '立即上报'}
              </button>
              <button
                type="button"
                onClick={() => remotePlayLogger.clear()}
                className="flex items-center justify-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800/80 px-2.5 py-1.5 text-xs font-semibold text-neutral-400 hover:text-white hover:bg-neutral-700 active:scale-95"
                title="清空客户端日志"
                aria-label="清空客户端日志"
              >
                <LuTrash2 size={13} />
              </button>
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-2.5 py-1 rounded-full border transition-colors ${
                  filter === 'all'
                    ? 'border-neutral-500 bg-neutral-700 text-white font-medium'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                全部 ({logs.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('issues')}
                className={`px-2.5 py-1 rounded-full border transition-colors ${
                  filter === 'issues'
                    ? 'border-rose-500/60 bg-rose-950/70 text-rose-300 font-medium'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                异常 ({issueCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('info')}
                className={`px-2.5 py-1 rounded-full border transition-colors ${
                  filter === 'info'
                    ? 'border-sky-500/60 bg-sky-950/70 text-sky-300 font-medium'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                常规 ({logs.length - issueCount})
              </button>
            </div>

            {/* Log list */}
            <div className="flex-1 overflow-y-auto rounded-lg border border-neutral-800/90 bg-neutral-950/90 p-2.5 font-mono text-[11px] space-y-2">
              {filteredLogs.length === 0 ? (
                <div className="py-8 text-center text-neutral-500 text-xs font-sans">暂无符合条件的日志</div>
              ) : (
                filteredLogs.map((entry) => {
                  const d = new Date(entry.ts)
                  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
                  const isExpanded = expandedMetaId === entry.id
                  return (
                    <div key={entry.id} className="border-b border-neutral-900 pb-1.5 last:border-0 last:pb-0">
                      <div className="flex items-start gap-1.5">
                        <span className="text-neutral-500 shrink-0 text-[10px] leading-4">{time}</span>
                        <span
                          className={`shrink-0 px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                            entry.level === 'ok'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                              : entry.level === 'fail'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800/60'
                              : entry.level === 'warn'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                              : entry.level === 'debug'
                              ? 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                              : 'bg-sky-950 text-sky-300 border border-sky-800/60'
                          }`}
                        >
                          {entry.level}
                        </span>
                        <span className="flex-1 text-neutral-200 break-words leading-tight">{entry.message}</span>
                        {entry.meta && (
                          <button
                            type="button"
                            onClick={() => setExpandedMetaId(isExpanded ? null : entry.id)}
                            className="shrink-0 text-neutral-400 hover:text-white"
                            aria-label="展开详情"
                          >
                            {isExpanded ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />}
                          </button>
                        )}
                      </div>
                      {entry.meta && isExpanded && (
                        <pre className="mt-1.5 overflow-x-auto rounded bg-neutral-900 p-2 text-[10px] text-neutral-300 whitespace-pre-wrap break-all">
                          {JSON.stringify(entry.meta, null, 2)}
                        </pre>
                      )}
                    </div>
                  )
                })
              )}
              <div ref={logEndRef} />
            </div>

            <div className="text-[10px] text-neutral-500 text-center">
              日志自动以 3.5s 周期或断线时批量同步至电脑端 Chaya 控制台
            </div>
          </div>
        ) : (
        <div className="flex-1 space-y-5 overflow-y-auto pt-4 pb-6">
          {/* 金币 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">金钱修改</h3>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleAddGold(10000)}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-emerald-400 hover:bg-neutral-700 active:scale-95"
              >
                +10,000 G
              </button>
              <button
                type="button"
                onClick={() => handleAddGold(100000)}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-emerald-400 hover:bg-neutral-700 active:scale-95"
              >
                +100,000 G
              </button>
              <button
                type="button"
                onClick={handleMaxGold}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-amber-400 hover:bg-neutral-700 active:scale-95"
              >
                拉满最大
              </button>
            </div>
          </section>

          {/* 队伍恢复 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">队伍生命与状态</h3>
            <button
              type="button"
              onClick={handleFullRecovery}
              className="w-full rounded-lg border border-rose-500/40 bg-rose-950/40 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 active:scale-95"
            >
              <span className="flex items-center justify-center gap-1.5">
                <LuHeart size={15} /> 全员满血满蓝 + 复活
              </span>
            </button>
          </section>

          {/* 常用开关 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">战斗与移动开关</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleToggleGod}
                className={`rounded-lg border py-2.5 text-xs font-semibold transition-colors active:scale-95 ${
                  godMode ? 'border-emerald-500 bg-emerald-600/30 text-emerald-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuShield size={14} /> 无敌锁血: {godMode ? '已开启' : '关闭'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleThrough}
                className={`rounded-lg border py-2.5 text-xs font-semibold transition-colors active:scale-95 ${
                  throughWalls ? 'border-indigo-500 bg-indigo-600/30 text-indigo-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuFootprints size={14} /> 穿墙移动: {throughWalls ? '已开启' : '关闭'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleAutoWin}
                className={`col-span-2 rounded-lg border py-2.5 text-xs font-semibold transition-colors active:scale-95 ${
                  autoWin ? 'border-amber-500 bg-amber-600/30 text-amber-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuSwords size={14} /> 遇敌必胜: {autoWin ? '已开启' : '关闭'}
                </span>
              </button>
            </div>
          </section>

          {/* 全局倍速 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">游戏倍速调节</h3>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 5].map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => handleChangeSpeed(speed)}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors active:scale-95 ${
                    gameSpeed === speed ? 'border-emerald-400 bg-emerald-500 text-neutral-950' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </section>

          {/* 快捷操作 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">快捷操作</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleQuickSave}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuSave size={14} /> 快速存档 (Slot 1)
                </span>
              </button>
              <button
                type="button"
                onClick={handleTogglePcUi}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuMonitor size={14} /> 唤出 PC 局内面板
                </span>
              </button>
            </div>
          </section>
        </div>
        )}

        {/* Footer */}
        <div className="border-t border-neutral-800 pt-3 text-center text-[11px] text-neutral-500">Chaya WebRTC Remote Play Console</div>
      </div>
    </div>
  )
}
