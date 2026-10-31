'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LuActivity,
  LuBug,
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCloudUpload,
  LuCopy,
  LuFootprints,
  LuHeart,
  LuMessageSquareText,
  LuMonitor,
  LuRotateCw,
  LuSave,
  LuScrollText,
  LuShield,
  LuSlidersHorizontal,
  LuSwords,
  LuTerminal,
  LuTrash2,
  LuX,
  LuZap,
} from 'react-icons/lu'

import type { GameEditCmd, GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import {
  destroyErudaMobileDevTools,
  initErudaMobileDevTools,
  isErudaActive,
} from '@/lib/runtime/mobile-devtools'
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
  hudVisible?: boolean
  onToggleHud?: () => void
  isPortrait?: boolean
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
  hudVisible = false,
  onToggleHud,
  isPortrait,
}: RemoteCheatDrawerProps) {
  const [activeTab, setActiveTab] = useState<'cheat' | 'logs'>(initialTab)
  const [godMode, setGodMode] = useState(false)
  const [throughWalls, setThroughWalls] = useState(false)
  const [autoWin, setAutoWin] = useState(false)
  const [autoTalk, setAutoTalk] = useState(false)
  const [gameSpeed, setGameSpeed] = useState<number>(1)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [logs, setLogs] = useState<RemotePlayLogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'issues' | 'info'>('all')
  const [expandedMetaId, setExpandedMetaId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const [devToolsActive, setDevToolsActive] = useState(false)
  const [copiedMacCmd, setCopiedMacCmd] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab)
    }
    setDevToolsActive(isErudaActive())
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

  const handleToggleDevTools = async () => {
    if (devToolsActive) {
      destroyErudaMobileDevTools()
      setDevToolsActive(false)
      showFeedback('已关闭手机 DevTools 控制台')
    } else {
      const ok = await initErudaMobileDevTools()
      if (ok) {
        setDevToolsActive(true)
        showFeedback('手机 DevTools 已启动 (屏幕右下角)')
      } else {
        showFeedback('启动 DevTools 失败')
      }
    }
  }

  const handleCopyMacCmd = async () => {
    const cmd = `curl -N "http://${window.location.hostname}:3000/api/logs/stream?source=remote-play"`
    const ok = await copyToClipboard(cmd)
    if (ok) {
      setCopiedMacCmd(true)
      showFeedback('已复制 Mac 终端实时监视命令')
      setTimeout(() => setCopiedMacCmd(false), 2000)
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
    sendCmd({ op: 'runFlag', key: 'through', value: next })
    showFeedback(next ? '已开启穿墙模式' : '已关闭穿墙模式')
  }

  const handleToggleAutoTalk = () => {
    const next = !autoTalk
    setAutoTalk(next)
    sendCmd({ op: 'runFlag', key: 'autotalk', value: next })
    showFeedback(next ? '已开启自动对话' : '已关闭自动对话')
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

  const isPortraitEffective =
    isPortrait ??
    (typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false)

  if (!open) return null

  return (
    <div
      style={{
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md transition-opacity select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className={`relative flex flex-col rounded-lg border border-[rgb(230_238_248/0.12)] bg-neutral-900/95 text-neutral-100 shadow-2xl backdrop-blur-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
          isPortraitEffective
            ? 'w-full max-w-lg max-h-[85vh] p-4 sm:p-5'
            : 'w-full max-w-2xl px-3.5 pt-2 pb-2.5'
        }`}
        style={{
          maxHeight: isPortraitEffective ? '85vh' : 'min(370px, 88vh)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: No divider line, text-sm font-semibold (Requirement 4) */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1 shrink-0">
          <h2 className="text-sm font-semibold text-white tracking-wide">局内控制台</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/5 active:scale-90 transition-all"
            aria-label="关闭"
          >
            <LuX size={16} />
          </button>
        </div>

        {/* Tab switch */}
        <div className="mt-1.5 flex gap-2 rounded-md bg-neutral-950 p-1 border border-neutral-800 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('cheat')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
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
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
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
        {feedback && <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-3 py-1.5 text-center text-xs font-semibold text-emerald-300 shrink-0">{feedback}</div>}

        {/* Body scroll area */}
        {activeTab === 'logs' ? (
          <div className="flex-1 flex flex-col min-h-0 pt-2 pb-1 space-y-2">
            {/* Summary & Mobile Debugging Cards */}
            <div className={isPortraitEffective ? 'space-y-2' : 'grid grid-cols-2 gap-2'}>
              {/* Summary card */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2.5 text-xs space-y-1.5">
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
                <span className="text-neutral-300 truncate max-w-[160px]" title={diagnostics.userAgent}>
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

              {/* Mobile Debugging Tools Box */}
              <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-sky-300">
                  <LuBug size={14} />
                  移动端调试工具箱
                </span>
                <span className="text-[10px] text-neutral-400">专为手机端调优</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={handleToggleDevTools}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 px-2 font-medium transition-all active:scale-95 ${
                    devToolsActive
                      ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-300 shadow-sm'
                      : 'border-neutral-700 bg-neutral-900/90 text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  <LuTerminal size={13} className={devToolsActive ? 'text-emerald-400' : 'text-neutral-400'} />
                  {devToolsActive ? '已开启手机控制台' : '开启手机控制台'}
                </button>

                <button
                  type="button"
                  onClick={onToggleHud}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 px-2 font-medium transition-all active:scale-95 ${
                    hudVisible
                      ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-300 shadow-sm'
                      : 'border-neutral-700 bg-neutral-900/90 text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  <LuActivity size={13} className={hudVisible ? 'text-emerald-400' : 'text-neutral-400'} />
                  {hudVisible ? '已显示性能 HUD' : '显示性能 HUD'}
                </button>

                <button
                  type="button"
                  onClick={handleCopyMacCmd}
                  className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900/90 py-1.5 px-2 font-medium text-neutral-300 hover:bg-neutral-800 active:scale-95"
                >
                  {copiedMacCmd ? <LuCheck size={13} className="text-emerald-400" /> : <LuTerminal size={13} />}
                  {copiedMacCmd ? '已复制命令' : '复制 Mac 终端监视命令'}
                </button>
              </div>
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
              日志自动以 3.5s 周期或断线时批量同步至电脑端控制台
            </div>
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-2">
          {isPortraitEffective ? (
            /* Portrait: 1 column vertical list */
            <div className="space-y-4">
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
                  className="w-full rounded-lg border border-rose-500/40 bg-rose-950/40 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 active:scale-95"
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
                    className={`rounded-lg border py-2 text-xs font-semibold transition-colors active:scale-95 ${
                      godMode ? 'border-emerald-500 bg-emerald-600/30 text-emerald-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuShield size={14} /> 无敌锁血: {godMode ? '开启' : '关闭'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleThrough}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-colors active:scale-95 ${
                      throughWalls ? 'border-indigo-500 bg-indigo-600/30 text-indigo-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuFootprints size={14} /> 穿墙移动: {throughWalls ? '开启' : '关闭'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleAutoTalk}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-colors active:scale-95 ${
                      autoTalk ? 'border-sky-500 bg-sky-600/30 text-sky-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuMessageSquareText size={14} /> 自动对话: {autoTalk ? '开启' : '关闭'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleAutoWin}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-colors active:scale-95 ${
                      autoWin ? 'border-amber-500 bg-amber-600/30 text-amber-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuSwords size={14} /> 遇敌必胜: {autoWin ? '开启' : '关闭'}
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
                      className={`rounded-lg border py-1.5 text-xs font-semibold transition-colors active:scale-95 ${
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
                    className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuSave size={14} /> 快速存档 (Slot 1)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTogglePcUi}
                    className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuMonitor size={14} /> 唤出 PC 面板
                    </span>
                  </button>
                </div>
              </section>
            </div>
          ) : (
            /* Landscape: 2-column game pause menu layout */
            <div className="grid grid-cols-2 gap-3.5 items-start">
              {/* Left Column: 数值与状态 */}
              <div className="space-y-3">
                {/* 金币 */}
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">金钱修改</h3>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleAddGold(10000)}
                      className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-1.5 text-[11px] font-medium text-emerald-400 hover:bg-neutral-700 active:scale-95"
                    >
                      +10,000 G
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddGold(100000)}
                      className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-1.5 text-[11px] font-medium text-emerald-400 hover:bg-neutral-700 active:scale-95"
                    >
                      +100,000 G
                    </button>
                    <button
                      type="button"
                      onClick={handleMaxGold}
                      className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-1.5 text-[11px] font-medium text-amber-400 hover:bg-neutral-700 active:scale-95"
                    >
                      拉满最大
                    </button>
                  </div>
                </section>

                {/* 队伍恢复 */}
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">队伍生命与状态</h3>
                  <button
                    type="button"
                    onClick={handleFullRecovery}
                    className="w-full rounded-lg border border-rose-500/40 bg-rose-950/40 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 active:scale-95"
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <LuHeart size={14} /> 全员满血满蓝 + 复活
                    </span>
                  </button>
                </section>

                {/* 全局倍速 */}
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">游戏倍速调节</h3>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 5].map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => handleChangeSpeed(speed)}
                        className={`rounded-lg border py-1.5 text-xs font-semibold transition-colors active:scale-95 ${
                          gameSpeed === speed ? 'border-emerald-400 bg-emerald-500 text-neutral-950 font-bold' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {/* Right Column: 开关与快捷操作 */}
              <div className="space-y-3">
                {/* 常用开关 */}
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">战斗与移动开关</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleToggleGod}
                      className={`rounded-lg border py-2 text-[11px] font-semibold transition-colors active:scale-95 ${
                        godMode ? 'border-emerald-500 bg-emerald-600/30 text-emerald-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        <LuShield size={13} /> 锁血: {godMode ? '开' : '关'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleThrough}
                      className={`rounded-lg border py-2 text-[11px] font-semibold transition-colors active:scale-95 ${
                        throughWalls ? 'border-indigo-500 bg-indigo-600/30 text-indigo-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        <LuFootprints size={13} /> 穿墙: {throughWalls ? '开' : '关'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleAutoTalk}
                      className={`rounded-lg border py-2 text-[11px] font-semibold transition-colors active:scale-95 ${
                        autoTalk ? 'border-sky-500 bg-sky-600/30 text-sky-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        <LuMessageSquareText size={13} /> 对话: {autoTalk ? '开' : '关'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleAutoWin}
                      className={`rounded-lg border py-2 text-[11px] font-semibold transition-colors active:scale-95 ${
                        autoWin ? 'border-amber-500 bg-amber-600/30 text-amber-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        <LuSwords size={13} /> 必胜: {autoWin ? '开' : '关'}
                      </span>
                    </button>
                  </div>
                </section>

                {/* 快捷操作 */}
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">快捷操作</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleQuickSave}
                      className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
                    >
                      <span className="flex items-center justify-center gap-1">
                        <LuSave size={13} /> 快速存档 (Slot 1)
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTogglePcUi}
                      className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
                    >
                      <span className="flex items-center justify-center gap-1">
                        <LuMonitor size={13} /> 唤出 PC 面板
                      </span>
                    </button>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
        )}

      </div>
    </div>
  )
}
