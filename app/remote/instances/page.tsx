'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { LuPower, LuTrash2, LuTv } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead, panelHeadEnd } from '@/components/layoutClasses'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { GameObserverModal } from '@/components/remote-play/GameObserverModal'
import { InstancePreview } from '@/components/remote-play/InstancePreview'
import { Badge, Button, Modal } from '@/components/sk'
import type { CloudGameInstance } from '@/services/runtime/game-instance-manager'

function RemoteInstancesContent() {
  const t = useT()
  const searchParams = useSearchParams()
  const targetGameParam = searchParams.get('game') || searchParams.get('roomId') || ''
  const [instances, setInstances] = useState<CloudGameInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<CloudGameInstance | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ pid: number; title: string } | null>(null)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)
  const autoOpenedRef = useRef(false)
  // Refresh fallback previews at most once every three minutes.
  const [screenshotKey, setScreenshotKey] = useState(() => Date.now())

  const fetchInstances = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true)
      try {
        const res = await fetch('/api/remote/instances')
        if (res.ok) {
          const data = await res.json()
          const list: CloudGameInstance[] = data.instances || []
          setInstances(list)

          // 若 URL 传入 ?game=... 则在首次加载时自动开启对应实例的监看窗口
          if (targetGameParam && !autoOpenedRef.current) {
            const matched = list.find(
              (inst) => inst.roomId === targetGameParam || inst.libraryId === targetGameParam || inst.contentRoot?.includes(targetGameParam) || String(inst.pid) === targetGameParam
            )
            if (matched) {
              autoOpenedRef.current = true
              setSelectedInstance(matched)
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
        if (!silent) setRefreshing(false)
      }
    },
    [targetGameParam]
  )

  useEffect(() => {
    fetchInstances()
    // 实例进程状态 12 秒轮询一次，不更新快照图片 URL，避免频繁拉取截图
    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchInstances(true)
    }, 12000)

    // 缩略快照每 3 分钟 (180s) 刷新一次即可，点开监看弹窗后才通过 WebRTC 实时观看
    const snapshotTimer = setInterval(() => {
      if (document.visibilityState === 'visible') setScreenshotKey(Date.now())
    }, 180000)

    return () => {
      clearInterval(pollTimer)
      clearInterval(snapshotTimer)
    }
  }, [fetchInstances])

  const handleTerminateOne = async (pid: number) => {
    try {
      setRefreshing(true)
      await fetch('/api/remote/instances', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      })
      setConfirmTarget(null)
      await fetchInstances()
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false)
    }
  }

  const handleTerminateAll = async () => {
    try {
      setRefreshing(true)
      await fetch('/api/remote/instances', { method: 'DELETE' })
      setConfirmAllOpen(false)
      await fetchInstances()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper-2">
      {/* Panel Head: 统一头部布局，无需单独刷新按钮 */}
      <div className={panelHead}>
        <PanelHeadTitle title={t('nav.remoteInstances')} description="查看局域网运行中的游戏实例与串流连接状态" />

        <div className={panelHeadEnd}>
          {instances.length > 0 && (
            <Button variant="fail" size="md" onClick={() => setConfirmAllOpen(true)} disabled={refreshing} className="gap-1.5" tooltip="终止并清理全部云游戏实例">
              <LuTrash2 size={13} />
              清理全部
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center p-6 text-xs text-ink-soft">正在扫描云游戏实例...</div>
      ) : instances.length === 0 ? (
        /* NODATA 完全垂直水平居中 */
        <div className="flex flex-1 h-full min-h-[360px] flex-col items-center justify-center p-6 text-center select-none">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent mb-3">
            <LuTv size={24} />
          </div>
          <h2 className="text-sm font-semibold text-ink m-0">当前暂无运行中的云游戏</h2>
          <p className="mt-1 max-w-sm text-xs text-ink-soft">启动云游戏串流或等待移动设备连接</p>
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
                  <InstancePreview
                    key={inst.libraryId || inst.instanceId}
                    libraryId={inst.libraryId}
                    screenshotUrl={inst.screenshotUrl}
                    refreshKey={screenshotKey}
                    title={inst.gameTitle}
                  />

                  {/* Stop button on top-right hover */}
                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmTarget({ pid: inst.pid, title: inst.gameTitle })
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
                    ) : inst.runMode === 'cloud' ? (
                      <Badge tone="warn" size="mini">
                        闲置 {inst.idleSeconds}s / 清理 {inst.remainingIdleSeconds}s
                      </Badge>
                    ) : (
                      <Badge tone="neutral" size="mini">
                        {t('play.localRunning')}
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

      {/* 二次确认：终止单项游戏实例 */}
      <Modal
        open={Boolean(confirmTarget)}
        title="确认终止游戏实例？"
        onClose={() => setConfirmTarget(null)}
        footer={
          <div className="flex items-center gap-2">
            <Button variant="plain" size="md" onClick={() => setConfirmTarget(null)}>
              取消
            </Button>
            <Button variant="fail" size="md" loading={refreshing} onClick={() => confirmTarget && handleTerminateOne(confirmTarget.pid)}>
              确认终止
            </Button>
          </div>
        }
      >
        <p className="text-xs text-ink-soft m-0 leading-relaxed">
          即将终止游戏进程「<strong className="text-ink">{confirmTarget?.title}</strong>」(PID: {confirmTarget?.pid})。未保存的游戏进度可能会丢失。
        </p>
      </Modal>

      {/* 二次确认：清理全部游戏实例 */}
      <Modal
        open={confirmAllOpen}
        title="确认清理全部云游戏实例？"
        onClose={() => setConfirmAllOpen(false)}
        footer={
          <div className="flex items-center gap-2">
            <Button variant="plain" size="md" onClick={() => setConfirmAllOpen(false)}>
              取消
            </Button>
            <Button variant="fail" size="md" loading={refreshing} onClick={handleTerminateAll}>
              全部终止
            </Button>
          </div>
        }
      >
        <p className="text-xs text-ink-soft m-0 leading-relaxed">
          即将结束当前所有运行中的 {instances.length} 个游戏进程并释放相关系统资源。请确认当前无正在游玩的关键未存盘数据。
        </p>
      </Modal>
    </div>
  )
}

export default function RemoteInstancesPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 text-xs text-ink-soft">正在加载...</div>}>
      <RemoteInstancesContent />
    </Suspense>
  )
}
