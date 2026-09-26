import { useCallback, useEffect, useRef, useState } from 'react'

import { useNotification } from '@/components/notification/useNotification'
import { readApiErrorMessage } from '@/lib/api-error'

import type { NwWindowConfig } from './types'

/** 每次保存捕获目标游戏；切换游戏后取消仍未发送的保存。 */
export function useWindowSettings(gameRoot: string) {
  const [win, setWin] = useState<NwWindowConfig | null>(null)
  const winSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useNotification()
  const currentRoot = useRef(gameRoot)
  currentRoot.current = gameRoot

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
        const res = await fetch('/api/window', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameRoot: targetRoot, window: next }),
        })
        const data = await res.json()
        if (!res.ok) {
          notify.error(readApiErrorMessage(data, '写入失败'))
          return
        }
        notify.success('已更新 · 重启游戏生效')
      } catch {
        notify.error('写入失败')
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
