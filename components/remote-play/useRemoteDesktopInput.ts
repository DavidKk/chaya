'use client'

import { useEffect, useEffectEvent } from 'react'

import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'

const KEY_MAP: Record<string, RemoteInputKey> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'ok',
  Space: 'ok',
  KeyZ: 'ok',
  Escape: 'cancel',
  KeyX: 'cancel',
  Numpad0: 'cancel',
  Tab: 'menu',
  KeyM: 'menu',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  KeyQ: 'pageup',
  KeyE: 'pagedown',
}

export function useRemoteDesktopInput({
  enabled,
  onInput,
  onFullscreen,
}: {
  enabled: boolean
  onInput: (key: RemoteInputKey, action: 'down' | 'up') => void
  onFullscreen: () => void
}) {
  const input = useEffectEvent(onInput)
  const fullscreen = useEffectEvent(onFullscreen)
  useEffect(() => {
    if (!enabled) return
    const pressed = new Set<RemoteInputKey>()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const isForm = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [role="dialog"]')
    const keyDown = (e: KeyboardEvent) => {
      if (isForm(e.target) || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'F11') {
        e.preventDefault()
        fullscreen()
        return
      }
      const key = KEY_MAP[e.code]
      if (!key) return
      e.preventDefault()
      if (!pressed.has(key)) input(key, 'down')
      pressed.add(key)
    }
    const keyUp = (e: KeyboardEvent) => {
      const key = KEY_MAP[e.code]
      if (!key || !pressed.has(key)) return
      e.preventDefault()
      pressed.delete(key)
      input(key, 'up')
    }
    const contextMenu = (e: MouseEvent) => {
      if (isForm(e.target)) return
      e.preventDefault()
      input('menu', 'down')
      const timer = setTimeout(() => {
        input('menu', 'up')
        timers.delete(timer)
      }, 50)
      timers.add(timer)
    }
    const release = () => {
      pressed.forEach((key) => input(key, 'up'))
      pressed.clear()
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('contextmenu', contextMenu)
    window.addEventListener('blur', release)
    return () => {
      release()
      timers.forEach(clearTimeout)
      if (timers.size) input('menu', 'up')
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('contextmenu', contextMenu)
      window.removeEventListener('blur', release)
    }
  }, [enabled])
}
