import { useCallback, useEffect, useRef, useState } from 'react'

import { useNotification } from '@/components/notification/useNotification'
import { readApiErrorMessage } from '@/lib/api-error'

import type { NwWindowConfig } from './types'

async function saveViaApi(next: NwWindowConfig, gameRoot: string): Promise<void> {
  const res = await fetch('/api/window', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameRoot, window: next }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(readApiErrorMessage(data, '写入失败'))
}

/**
 * 每次保存捕获目标游戏；切换游戏后取消仍未发送的保存。
 * 默认写本机 `/api/window`；浏览器模式传入 `save` 经 FSA 改 package.json。
 */
export function useWindowSettings(gameRoot: string, save: (next: NwWindowConfig, gameRoot: string) => Promise<void> = saveViaApi) {
  const [win, setWin] = useState<NwWindowConfig | null>(null)
  const winSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useNotification()
  const currentRoot = useRef(gameRoot)
  currentRoot.current = gameRoot
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    return () => {
      if (winSaveTimer.current) clearTimeout(winSaveTimer.current)
      winSaveTimer.current = null
    }
  }, [gameRoot])

  const persistWindow = useCallback(
    async (next: NwWindowConfig, targetRoot: string) => {
      if (!targetRoot || currentRoot.current !== targetRoot) return
      try {
        await saveRef.current(next, targetRoot)
        notify.success('已更新 · 重启游戏生效')
      } catch (error) {
        notify.error(error instanceof Error && error.message ? error.message : '写入失败')
      }
    },
    [notify]
  )

  function schedule(next: NwWindowConfig, delay: number) {
    const targetRoot = gameRoot
    if (winSaveTimer.current) clearTimeout(winSaveTimer.current)
    winSaveTimer.current = setTimeout(() => {
      winSaveTimer.current = null
      void persistWindow(next, targetRoot)
    }, delay)
    setWin(next)
  }

  function patchWin<K extends keyof NwWindowConfig>(key: K, value: NwWindowConfig[K], immediate = false) {
    if (win) schedule({ ...win, [key]: value }, immediate ? 0 : 400)
  }

  function patchWinSize(size: { width: number; height: number }) {
    if (win) schedule({ ...win, ...size }, 400)
  }

  return { win, setWin, winSaveTimer, patchWin, patchWinSize }
}
