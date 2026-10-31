'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LuGamepad2,
  LuTv,
  LuPlay,
  LuPower,
  LuTrash2,
} from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead, panelHeadEnd } from '@/components/layoutClasses'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { GameObserverModal } from '@/components/remote-play/GameObserverModal'
import { Badge, Button } from '@/components/sk'
import type { CloudGameInstance } from '@/services/runtime/game-instance-manager'

export default function RemoteInstancesPage() {
  const t = useT()
  const [instances, setInstances] = useState<CloudGameInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<CloudGameInstance | null>(null)
  // 缩略图只在首次加载或每 3 分钟更新一次，减少资源消耗与信令请求
  const [screenshotKey, setScreenshotKey] = useState(Date.now())

  const fetchInstances = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await fetch('/api/remote/instances')
      if (res.ok) {
        const data = await res.json()
        setInstances(data.instances || [])
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
    // 实例进程状态 12 秒轮询一次，不更新快照图片 URL，避免频繁拉取截图
    const pollTimer = setInterval(() => {
      fetchInstances(true)
    }, 12000)

    // 缩略快照每 3 分钟 (180s) 刷新一次即可，点开监看弹窗后才通过 WebRTC 实时观看
    const snapshotTimer = setInterval(() => {
      setScreenshotKey(Date.now())
    }, 180000)

    return () => {
      clearInterval(pollTimer)
      clearInterval(snapshotTimer)
    }
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
    if (!window.confirm('确定要清理并结束所有运行中的云游戏实例吗？')) return
    try {
      setRefreshing(true)
      await fetch('/api/remote/instances', { method: 'DELETE' })
      await fetchInstances()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper-2">
      {/* Panel Head: 统一头部布局，无需单独刷新按钮 */}
      <div className={panelHead}>
        <PanelHeadTitle
          title={t('nav.remoteInstances')}
          description="查看局域网运行中的游戏实例与串流连接状态"
        />

        <div className={panelHeadEnd}>
          {instances.length > 0 && (
            <Button
              variant="fail"
              size="md"
              onClick={handleTerminateAll}
              disabled={refreshing}
              className="gap-1.5"
              tooltip="终止并清理全部云游戏实例"
            >
              <LuTrash2 size={13} />
              清理全部
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center p-6 text-xs text-ink-soft">
          正在扫描云游戏实例...
        </div>
      ) : instances.length === 0 ? (
        /* NODATA 完全垂直水平居中 */
        <div className="flex flex-1 h-full min-h-[360px] flex-col items-center justify-center p-6 text-center select-none">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent mb-3">
            <LuTv size={24} />
          </div>
          <h2 className="text-sm font-semibold text-ink m-0">当前暂无运行中的云游戏</h2>
          <p className="mt-1 max-w-sm text-xs text-ink-soft">
            启动云游戏串流或等待移动设备连接
          </p>
          <div className="mt-4 flex items-center gap-2.5">
            <Link href="/play" target="_blank">
              <Button variant="accent" size="md" className="gap-1.5 text-xs">
                <LuTv size={14} />
                进入云游戏
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {instances.map((inst) => (
              <div
                key={inst.instanceId}
                onClick={() => setSelectedInstance(inst)}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-panel hover:border-accent/40 hover:bg-panel-2 transition-all cursor-pointer select-none"
              >
                {/* Compact Thumbnail Frame */}
                <div className="relative aspect-video max-h-32 w-full bg-black/80 overflow-hidden border-b border-line flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${inst.screenshotUrl}&t=${screenshotKey}`}
                    alt={inst.gameTitle}
                    className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                  />

                  {/* Stop button on top-right hover */}
                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTerminateOne(inst.pid)
                      }}
                      className="h-6 w-6 rounded bg-black/60 text-fail hover:bg-fail/20"
                      tooltip="终止实例"
                    >
                      <LuPower size={12} />
                    </Button>
                  </div>
                </div>

                {/* Compact Card Details: Game Title + Badges only */}
                <div className="flex flex-col p-2.5 gap-1.5">
                  <h3 className="text-xs font-semibold text-ink truncate m-0" title={inst.gameTitle}>
                    {inst.gameTitle}
                  </h3>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" size="mini">
                      PID: {inst.pid}
                    </Badge>
                    <Badge tone="info" size="mini">
                      {inst.clientIp || '本机'}
                    </Badge>
                    {inst.webConnected ? (
                      <Badge tone="ok" size="mini">
                        游玩中
                      </Badge>
                    ) : (
                      <Badge tone="warn" size="mini">
                        闲置 {inst.idleSeconds}s / 清理 {inst.remainingIdleSeconds}s
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
    </div>
  )
}
