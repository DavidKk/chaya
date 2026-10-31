'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  LuClock,
  LuExternalLink,
  LuGamepad2,
  LuMaximize2,
  LuPlay,
  LuPower,
  LuRefreshCw,
  LuSmartphone,
  LuSparkles,
  LuTrash2,
  LuTv,
} from 'react-icons/lu'
import Link from 'next/link'

import { pageMain } from '@/components/layoutClasses'
import { GameObserverModal } from '@/components/remote-play/GameObserverModal'
import { Badge, Button, EmptyState } from '@/components/sk'
import type { CloudGameInstance } from '@/services/runtime/game-instance-manager'

export default function RemotePlayManagementPage() {
  const [instances, setInstances] = useState<CloudGameInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<CloudGameInstance | null>(null)
  const [screenshotKey, setScreenshotKey] = useState(Date.now())

  const fetchInstances = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await fetch('/api/remote/instances')
      if (res.ok) {
        const data = await res.json()
        setInstances(data.instances || [])
        setScreenshotKey(Date.now())
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
      if (!silent) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchInstances()
    const pollTimer = setInterval(() => {
      fetchInstances(true)
    }, 4000)
    return () => clearInterval(pollTimer)
  }, [fetchInstances])

  const handleTerminateOne = async (pid: number) => {
    try {
      await fetch('/api/remote/instances', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      })
      await fetchInstances()
    } catch {
      /* ignore */
    }
  }

  const handleTerminateAll = async () => {
    if (!window.confirm('确定要一键清理并结束所有运行中的云游戏实例吗？')) return
    try {
      setRefreshing(true)
      await fetch('/api/remote/instances', { method: 'DELETE' })
      await fetchInstances()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <main className={pageMain}>
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-ink m-0">云游戏管理</h1>
            {instances.length > 0 ? (
              <Badge tone="ok" className="px-2 py-0.5 text-xs">
                运行中 ({instances.length})
              </Badge>
            ) : (
              <Badge tone="neutral" className="px-2 py-0.5 text-xs">
                无运行实例
              </Badge>
            )}
            <Badge tone="info" className="hidden sm:inline-flex px-2 py-0.5 text-xs text-sky-300">
              闲置 5 分钟自动清理
            </Badge>
          </div>
          <p className="mt-1 text-xs text-ink-soft m-0">
            监控当前主机运行的 RPG Maker 游戏实例，查看实时画面与连接状态，防止无连接游戏无限占用硬件资源。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="md"
            onClick={() => fetchInstances()}
            disabled={refreshing}
            className="h-8 gap-1 text-xs"
          >
            <LuRefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </Button>

          {instances.length > 0 && (
            <Button
              variant="fail"
              size="md"
              onClick={handleTerminateAll}
              disabled={refreshing}
              className="h-8 gap-1 text-xs bg-rose-600/80 hover:bg-rose-600 text-white border-0"
            >
              <LuTrash2 size={13} />
              清理全部实例
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center p-12 text-sm text-ink-soft">
          <LuRefreshCw size={18} className="animate-spin mr-2" />
          正在扫描运行中的云游戏实例...
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="flex flex-col items-center max-w-md text-center p-8 rounded-xl border border-line bg-paper-2 shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent mb-4">
              <LuGamepad2 size={28} />
            </div>
            <h2 className="text-base font-semibold text-ink m-0">当前暂无运行中的云游戏</h2>
            <p className="mt-2 text-xs text-ink-soft leading-relaxed">
              当您在本机启动 RPG Maker 游戏或通过移动端串流游玩时，活跃的云游戏实例将自动汇总在此处。
              无人连接时将自动进入倒计时并在 5 分钟后彻底释放进程。
            </p>
            <div className="mt-5 flex items-center gap-3">
              <Link href="/game">
                <Button variant="accent" size="md" className="gap-1 text-xs">
                  <LuPlay size={13} />
                  前往游戏库启动
                </Button>
              </Link>
              <Link href="/play" target="_blank">
                <Button variant="default" size="md" className="gap-1 text-xs">
                  <LuExternalLink size={13} />
                  打开串流客户端
                </Button>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {instances.map((inst) => {
            const playUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${inst.streamUrl}`
            return (
              <div
                key={inst.instanceId}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-paper-2 hover:border-line-hover transition-all shadow-sm hover:shadow-md"
              >
                {/* Card Thumbnail Frame */}
                <div
                  className="relative aspect-video w-full bg-black/90 cursor-pointer overflow-hidden border-b border-line"
                  onClick={() => setSelectedInstance(inst)}
                  title="点击放大监看画面"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${inst.screenshotUrl}&t=${screenshotKey}`}
                    alt={inst.gameTitle}
                    className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm border border-white/20">
                      <LuMaximize2 size={13} />
                      点击放大监看
                    </span>
                  </div>

                  {/* Status Badge in corner */}
                  <div className="absolute top-2.5 right-2.5">
                    {inst.webConnected ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-950/85 border border-emerald-500/40 px-2.5 py-0.5 text-[0.7rem] font-medium text-emerald-300 backdrop-blur-sm shadow-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        玩家游玩中
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-amber-950/85 border border-amber-500/40 px-2 py-0.5 text-[0.7rem] font-medium text-amber-300 backdrop-blur-sm shadow-sm">
                        <LuClock size={11} />
                        闲置 ({inst.idleSeconds}s)
                      </span>
                    )}
                  </div>

                  <div className="absolute bottom-2 left-2 pointer-events-none rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] text-white/80 font-mono backdrop-blur-sm">
                    PID {inst.pid}
                  </div>
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-ink truncate m-0" title={inst.gameTitle}>
                      {inst.gameTitle}
                    </h3>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-ink-soft">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-ink-soft">
                        <LuSmartphone size={13} />
                        连接设备:
                      </span>
                      <span className="font-mono text-ink">
                        {inst.clientIp ? inst.clientIp : inst.webConnected ? '已连接' : '无'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-ink-soft">
                        <LuClock size={13} />
                        自动清理倒计时:
                      </span>
                      <span className={`font-mono ${inst.webConnected ? 'text-emerald-400' : 'text-amber-400 font-semibold'}`}>
                        {inst.webConnected ? '连接中（不计时）' : `${inst.remainingIdleSeconds} 秒后`}
                      </span>
                    </div>

                    {inst.contentRoot && (
                      <div className="truncate text-[0.68rem] text-ink-subtle" title={inst.contentRoot}>
                        路径: {inst.contentRoot}
                      </div>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-2">
                    <Button
                      variant="accent"
                      size="md"
                      onClick={() => setSelectedInstance(inst)}
                      className="h-7 text-xs gap-1 flex-1"
                    >
                      <LuTv size={13} />
                      监看画面
                    </Button>

                    <Button
                      variant="default"
                      size="md"
                      onClick={() => {
                        navigator.clipboard.writeText(playUrl)
                        alert('已复制游玩地址到剪切板！')
                      }}
                      className="h-7 px-2 text-xs"
                      title="复制游玩地址"
                    >
                      <LuExternalLink size={13} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => handleTerminateOne(inst.pid)}
                      className="h-7 px-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                      title="结束实例"
                    >
                      <LuPower size={13} />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Observation Modal */}
      <GameObserverModal
        instance={selectedInstance}
        open={Boolean(selectedInstance)}
        onClose={() => setSelectedInstance(null)}
        onTerminate={async (pid) => {
          await handleTerminateOne(pid)
          setSelectedInstance(null)
        }}
      />
    </main>
  )
}
