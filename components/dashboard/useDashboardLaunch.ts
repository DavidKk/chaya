import { useEffect, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useNotification } from '@/components/notification/useNotification'
import { readApiErrorMessage } from '@/lib/api-error'

import { libraryIdForRoot, type Status } from './types'

type Options = {
  status: Status | null
  busy: boolean
  setBusy: (value: boolean) => void
  pollStatus: () => Promise<void>
  queryGameId: string | null
}

export function useDashboardLaunch({ status, busy, setBusy, pollStatus, queryGameId }: Options) {
  const [launchPending, setLaunchPending] = useState(false)
  const gameLink = useGameLinkContext()
  const notify = useNotification()
  /** WebRTC 连上即在线 */
  useEffect(() => {
    if (gameLink.connected) setLaunchPending(false)
  }, [gameLink.connected])

  /** 启动后长时间未连上：解除本地锁，避免一直卡在「等待连接」 */
  useEffect(() => {
    if (!launchPending) return
    const timer = setTimeout(() => {
      setLaunchPending(false)
      notify.warning('等待游戏连接超时，可再点「开始游戏」')
    }, 60_000)
    return () => clearTimeout(timer)
  }, [launchPending, notify])

  async function launchGame() {
    if (gameLink.connected || launchPending || busy) {
      notify.info(gameLink.connected ? '游戏已在运行' : '正在等待游戏连上控制台')
      return
    }
    // 先本地锁死，防止连点开多窗；等 WebRTC 连上后再解除
    setLaunchPending(true)
    setBusy(true)
    try {
      const id = status && status.ready ? libraryIdForRoot(status.library || [], status.config.gameRoot) : queryGameId
      if (id) gameLink.armRoom(id)
      // 断线后须重新发 offer，并清掉信令板上的 webConnected，否则 POST 会误判 ALREADY_RUNNING
      await gameLink.restart(id || undefined)
      const res = await fetch('/api/launch', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setLaunchPending(false)
        notify.error(readApiErrorMessage(data, '无法启动游戏'))
        return
      }
      notify.success('已启动，等待游戏与控制台建立连接…')
      void pollStatus()
    } catch {
      setLaunchPending(false)
      notify.error('无法启动游戏')
    } finally {
      setBusy(false)
    }
  }

  async function quitGame() {
    if (busy) return
    setBusy(true)
    try {
      gameLink.quit('dashboard')
      setLaunchPending(false)
      notify.success('已发送关闭指令…')
      // 兼容旧路径
      void fetch('/api/launch', { method: 'DELETE' })
    } finally {
      setBusy(false)
    }
  }

  return { launchPending, launchGame, quitGame }
}
