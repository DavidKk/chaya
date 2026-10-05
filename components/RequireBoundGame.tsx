'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import { ChooseGameGate } from '@/components/ChooseGameGate'
import { useGameLinkContext } from '@/components/GameLinkProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { pageMainFlush } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { readApiErrorMessage } from '@/lib/api-error'
import { readUnsupportedEngine } from '@/lib/game/unsupported-engine'

type GatePhase = 'loading' | 'cloud' | 'need-game' | 'ready'

type StatusLite = {
  ready?: boolean
  canUseDisk?: boolean
  library?: unknown[]
}

/**
 * 修改 / 翻译：当前游戏已绑定且连接成功才展示功能，否则展示「选择游戏」。
 * - 库为空：直接打开系统选择器并绑定（与游戏库「选择游戏」相同）
 * - 库有条目但未选中：跳转游戏库从左侧点选
 * 日志页不经此门闸。
 * `loadingFallback`：状态拉取中展示正常数据骨架（勿用居中按钮条）。
 */
export function RequireBoundGame({ children, loadingFallback }: { children: ReactNode; loadingFallback?: ReactNode }) {
  const t = useT()
  const router = useRouter()
  const gameLink = useGameLinkContext()
  const notify = useNotification()
  const [phase, setPhase] = useState<GatePhase>('loading')
  const [libraryEmpty, setLibraryEmpty] = useState(true)
  const [busy, setBusy] = useState(false)

  const refreshPhase = useCallback(async () => {
    const res = await fetch('/api/status')
    const data = (await res.json()) as StatusLite
    if (data.canUseDisk === false) {
      setPhase('cloud')
      return
    }
    setLibraryEmpty(!Array.isArray(data.library) || data.library.length === 0)
    setPhase(data.ready ? 'ready' : 'need-game')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/status')
        const data = (await res.json()) as StatusLite
        if (cancelled) return
        if (data.canUseDisk === false) {
          setPhase('cloud')
          return
        }
        setLibraryEmpty(!Array.isArray(data.library) || data.library.length === 0)
        setPhase(data.ready ? 'ready' : 'need-game')
      } catch {
        if (!cancelled) setPhase('need-game')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
      await refreshPhase()
    } catch {
      notify.error(t('notify.pickerUnavailable'))
    } finally {
      setBusy(false)
    }
  }, [notify, refreshPhase, t])

  const onChoose = useCallback(() => {
    if (libraryEmpty && phase !== 'ready') {
      void pickAndBind()
      return
    }
    router.push('/game')
  }, [libraryEmpty, phase, pickAndBind, router])

  if (phase === 'loading') {
    if (loadingFallback) return <>{loadingFallback}</>
    return (
      <div className={pageMainFlush}>
        <SkeletonRegion label="加载" className="flex min-h-0 flex-1 items-center justify-center">
          <Skeleton className="h-8 w-40" />
        </SkeletonRegion>
      </div>
    )
  }

  const hasGame = phase === 'ready' || (phase === 'cloud' && !!gameLink.roomId)
  if (hasGame && gameLink.connected) return children

  if (phase === 'cloud') {
    return (
      <div className={pageMainFlush}>
        <ChooseGameGate canUseDisk={false} chooseIntent="library" onChoose={() => router.push('/game')} />
      </div>
    )
  }

  return (
    <div className={pageMainFlush}>
      <ChooseGameGate busy={busy} chooseIntent={libraryEmpty && phase !== 'ready' ? 'pick' : 'library'} onChoose={onChoose} />
    </div>
  )
}
