'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { useSafeSearchParams } from '@/components/translate/safe-navigation'
import { readApiErrorMessage } from '@/lib/api-error'
import { readUnsupportedEngine } from '@/lib/game/unsupported-engine'

type StatusPhase = 'loading' | 'cloud' | 'need-game' | 'ready'

/** loading：拉取中；need-game：未选游戏；need-link：已选但当前模式要求先连接；ready：可用 */
export type BoundGameAccess = 'loading' | 'need-game' | 'need-link' | 'ready'

type StatusLite = {
  ready?: boolean
  canUseDisk?: boolean
  remote?: boolean
  config?: { gameRoot?: string }
  selected?: string
  library?: Array<{ id: string; gameRoot: string; missing?: boolean }>
}

let cachedStatus: StatusLite | null = null

export function setCachedBoundGameStatusForTests(status: StatusLite | null) {
  cachedStatus = status
}

export type BoundGameState = {
  access: BoundGameAccess
  cloud: boolean
  busy: boolean
  /** 本机库为空：直接打开系统选目录并绑定；否则跳转游戏库点选 */
  onChoose: () => void
}

/**
 * 翻译页用的绑定状态（修改页未连接时只读，不经此 hook）。
 * - `allowLocalOffline`：本机服务 + 本机游戏时选中即可用（走服务端磁盘接口），不要求游戏在运行
 * - 云端 / 远程游戏：选中后仍须连接
 */
export function useBoundGame({ allowLocalOffline = false }: { allowLocalOffline?: boolean } = {}): BoundGameState {
  const t = useT()
  const router = useRouter()
  const searchParams = useSafeSearchParams()
  const urlGameId = searchParams?.get('game') || ''
  const gameLink = useGameLinkContext()
  const notify = useNotification()
  const initialData = process.env.NODE_ENV !== 'test' ? cachedStatus : null
  const [phase, setPhase] = useState<StatusPhase>(() => {
    if (!initialData) return 'loading'
    if (initialData.canUseDisk === false) return 'cloud'
    return initialData.ready ? 'ready' : 'need-game'
  })
  const [libraryEmpty, setLibraryEmpty] = useState(() => !Array.isArray(initialData?.library) || initialData.library.length === 0)
  const [remote, setRemote] = useState(() => initialData?.remote === true)
  const [busy, setBusy] = useState(false)

  const applyStatus = useCallback(
    (data: StatusLite) => {
      cachedStatus = data
      if (data.canUseDisk === false) {
        setPhase('cloud')
        return
      }
      setLibraryEmpty(!Array.isArray(data.library) || data.library.length === 0)
      setRemote(data.remote === true)
      setPhase(data.ready ? 'ready' : 'need-game')
      if (!urlGameId && typeof window !== 'undefined' && data.ready) {
        const target = data.selected || data.config?.gameRoot
        const entry = data.library?.find((item) => item.gameRoot === target || item.id === target)
        if (entry && !entry.missing) {
          const u = new URL(window.location.href)
          u.searchParams.set('game', entry.id)
          window.history.replaceState(null, '', u.toString())
        }
      }
    },
    [urlGameId]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const url = urlGameId ? `/api/status?game=${encodeURIComponent(urlGameId)}` : '/api/status'
        const res = await fetch(url)
        const data = (await res.json()) as StatusLite
        if (!cancelled) applyStatus(data)
      } catch {
        if (!cancelled) setPhase('need-game')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyStatus, urlGameId])

  const pickAndBind = useCallback(async () => {
    setBusy(true)
    notify.info(t('notify.pickOpening'))
    try {
      const pickRes = await fetch('/api/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'game' }),
      })
      const pickData = (await pickRes.json()) as {
        ok?: boolean
        path?: string
        cancelled?: boolean
        error?: string
      }
      if (pickData.cancelled || !pickData.ok || !pickData.path) {
        notify[pickData.cancelled ? 'info' : 'error'](pickData.cancelled ? t('notify.cancelled') : readApiErrorMessage(pickData, t('notify.pickFailed')))
        return
      }

      const bindRes = await fetch('/api/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameRoot: pickData.path }),
      })
      const bindData = await bindRes.json()
      if (!bindRes.ok) {
        const engine = readUnsupportedEngine(bindData)
        notify.error(engine ? t('notify.unsupportedEngine', { engine }) : readApiErrorMessage(bindData, t('notify.bindFailed')))
        return
      }
      notify.success(t('notify.addedToLibrary'))
      const res = await fetch('/api/status')
      applyStatus((await res.json()) as StatusLite)
    } catch {
      notify.error(t('notify.pickerUnavailable'))
    } finally {
      setBusy(false)
    }
  }, [applyStatus, notify, t])

  const cloud = phase === 'cloud'
  const chooseIntent = !cloud && libraryEmpty && phase !== 'ready' ? 'pick' : 'library'

  const onChoose = useCallback(() => {
    if (chooseIntent === 'pick') {
      void pickAndBind()
      return
    }
    router.push(urlGameId ? `/game?game=${encodeURIComponent(urlGameId)}` : '/game')
  }, [chooseIntent, pickAndBind, router, urlGameId])

  const hasGame = phase === 'ready' || (cloud && !!gameLink.roomId)
  let access: BoundGameAccess
  if (phase === 'loading') access = 'loading'
  else if (!hasGame) access = 'need-game'
  else if (gameLink.connected || (allowLocalOffline && phase === 'ready' && !remote)) access = 'ready'
  else access = 'need-link'

  return { access, cloud, busy, onChoose }
}
