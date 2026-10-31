'use client'

import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { LuCircleDot, LuHeart, LuMessageCircle, LuPackage, LuPlay, LuSwords, LuTrophy, LuX, LuZap } from 'react-icons/lu'

import type { RunFlagKey } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { type FloatingShortcutId, floatingShortcutNeedsBattle, parseFloatingShortcut } from '@/lib/game-agent/floating-ball'
import type { MessageKey } from '@/lib/i18n'

import { FLOATING_BALL_FRAME_SIZE, FLOATING_BALL_SIZE, FLOATING_SHORTCUT_SIZE, floatingBallLayout } from './floating-ball-layout'
import { viewport } from './floating-placement'
import { FLOATING_SHORTCUT_LABELS } from './floating-shortcuts'
import { stopGameKeys } from './game-keys'
import { useFloatingBallPosition } from './useFloatingBallPosition'

export type FloatingBallSnapshot = { ready: boolean; inBattle: boolean; flags: Partial<Record<RunFlagKey, boolean>> }
export type FloatingBallRuntime = {
  read: () => FloatingBallSnapshot | Promise<FloatingBallSnapshot>
  execute: (id: FloatingShortcutId) => void | Promise<void>
  supports?: (id: FloatingShortcutId) => boolean
  restoreFocus?: () => void
}

const EMPTY_SNAPSHOT: FloatingBallSnapshot = { ready: false, inBattle: false, flags: {} }

export function floatingShortcutDisabledReason(id: FloatingShortcutId, snapshot: FloatingBallSnapshot, supported = true): MessageKey | null {
  if (!supported) return 'floatingBall.unsupported'
  if (!snapshot.ready) return 'floatingBall.notReady'
  const shortcut = parseFloatingShortcut(id)
  if (shortcut?.kind === 'flag' && typeof snapshot.flags[shortcut.target] !== 'boolean') return 'floatingBall.unsupported'
  if (shortcut?.kind === 'action') {
    if (floatingShortcutNeedsBattle(shortcut.target) && !snapshot.inBattle) return 'floatingBall.needBattle'
    if (shortcut.target.startsWith('scene:') && snapshot.inBattle) return 'floatingBall.leaveBattle'
  }
  return null
}

/** Shared by MV/MZ and RGSS; adapters read and execute against the running game. */
export function FloatingBall({ shortcuts, runtime }: { shortcuts: FloatingShortcutId[]; runtime: FloatingBallRuntime }) {
  const t = useT()
  const groupId = useId()
  const [open, setOpen] = useState(false)
  const { position, placed, dragging, handlers, consumeDragClick } = useFloatingBallPosition(() => {
    if (!open) runtime.restoreFocus?.()
  })
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [pending, setPending] = useState<FloatingShortcutId | null>(null)
  const [error, setError] = useState('')
  const [layout, setLayout] = useState(() => floatingBallLayout(position, shortcuts.length, { left: 0, top: 0, width: 320, height: 480 }))
  const ball = useRef<HTMLButtonElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const executing = useRef(false)
  const readVersion = useRef(0)
  const focusShortcuts = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function close(focusBall = false) {
    setOpen(false)
    setError('')
    if (focusBall) ball.current?.focus()
    else {
      const active = root.current?.getRootNode() as Document | ShadowRoot | undefined
      if (active?.activeElement instanceof HTMLElement && root.current?.contains(active.activeElement)) active.activeElement.blur()
      runtimeRef.current.restoreFocus?.()
    }
  }

  useEffect(() => {
    // The RGSS native host consumes Escape and forwards this event to WebKit.
    const escape = (event: Event) => {
      const active = (root.current?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement
      if (!open && (!active || !root.current?.contains(active))) return
      event.stopImmediatePropagation()
      close()
    }
    document.addEventListener('chaya:esc', escape, true)
    return () => document.removeEventListener('chaya:esc', escape, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    let disposed = false
    let reading = false
    const refresh = async () => {
      if (reading || executing.current) return
      reading = true
      const version = readVersion.current
      try {
        const next = await runtimeRef.current.read()
        if (!disposed && !executing.current && version === readVersion.current) setSnapshot(next)
      } catch {
        if (!disposed && version === readVersion.current) {
          setSnapshot(EMPTY_SNAPSHOT)
          setError(t('floatingBall.failed'))
        }
      } finally {
        reading = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 600)
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(root.current!)) close()
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open, t])

  useEffect(() => {
    if (!open || !focusShortcuts.current) return
    const first = group.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    if (first) {
      first.focus()
      focusShortcuts.current = false
    }
  }, [open, snapshot])

  useLayoutEffect(() => {
    if (!open) return
    const updateLayout = () => setLayout(floatingBallLayout(position, shortcuts.length, viewport()))
    updateLayout()
    window.addEventListener('resize', updateLayout)
    window.visualViewport?.addEventListener('resize', updateLayout)
    window.visualViewport?.addEventListener('scroll', updateLayout)
    return () => {
      window.removeEventListener('resize', updateLayout)
      window.visualViewport?.removeEventListener('resize', updateLayout)
      window.visualViewport?.removeEventListener('scroll', updateLayout)
    }
  }, [open, position, shortcuts.length])

  async function execute(id: FloatingShortcutId) {
    if (executing.current) return
    executing.current = true
    readVersion.current += 1
    setPending(id)
    setError('')
    try {
      // Re-read before toggling: a hotkey or another client may have changed it.
      const current = await runtimeRef.current.read()
      const reason = floatingShortcutDisabledReason(id, current, runtimeRef.current.supports?.(id) ?? true)
      if (reason) {
        if (mounted.current) {
          setSnapshot(current)
          setError(t(reason))
        }
        return
      }
      await runtimeRef.current.execute(id)
      const next = await runtimeRef.current.read()
      if (mounted.current) {
        setSnapshot(next)
        if (parseFloatingShortcut(id)?.kind === 'action') close()
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t('floatingBall.failed'))
    } finally {
      executing.current = false
      if (mounted.current) setPending(null)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    stopGameKeys(event)
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab' && open) {
      close(true)
    } else if (open && group.current?.contains(event.target as Node) && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = [...group.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const index = items.indexOf(event.target as HTMLButtonElement)
      const next =
        event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + items.length) % items.length
      items[next]?.focus()
    }
  }

  return (
    <div ref={root} data-floating-ball="" onKeyDown={onKeyDown} onKeyUp={stopGameKeys} onKeyPress={stopGameKeys}>
      <div
        className="pointer-events-auto fixed z-[60] opacity-[var(--mini-panel-opacity,0.4)] transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100"
        style={{
          left: open ? layout.center.x : position.x,
          top: open ? layout.center.y : position.y,
          visibility: placed ? undefined : 'hidden',
          opacity: open || dragging ? 1 : undefined,
        }}
      >
        <Button
          {...handlers}
          onPointerDown={(event) => handlers.onPointerDown(event, open ? layout.center : position)}
          ref={ball}
          variant="default"
          className="shrink-0 touch-none select-none rounded-full bg-panel/95 p-0 shadow-lg backdrop-blur-md focus-visible:ring-2 focus-visible:ring-accent"
          style={{ width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }}
          aria-label={t(open ? 'floatingBall.close' : 'floatingBall.open')}
          aria-expanded={open}
          aria-controls={open ? groupId : undefined}
          tooltip={t(open ? 'floatingBall.close' : 'floatingBall.open')}
          tooltipSuppressed={dragging}
          onClick={(event) => {
            if (event.detail !== 0 && consumeDragClick()) return
            if (open) close()
            else {
              focusShortcuts.current = true
              setSnapshot(EMPTY_SNAPSHOT)
              setOpen(true)
            }
          }}
        >
          {open ? <LuX size={20} className="shrink-0" /> : <LuCircleDot size={20} className="shrink-0" />}
        </Button>
      </div>
      {open ? (
        <div
          ref={group}
          id={groupId}
          role="group"
          aria-label={t('floatingBall.title')}
          data-rgss-interactive=""
          className="pointer-events-none fixed z-[70] text-ink"
          style={{
            left: layout.x,
            top: layout.y,
            width: FLOATING_BALL_FRAME_SIZE,
            height: FLOATING_BALL_FRAME_SIZE,
            transform: `scale(${layout.scale})`,
            transformOrigin: 'top left',
          }}
        >
          {shortcuts.length ? (
            shortcuts.map((id, index) => {
              const target = FLOATING_SHORTCUT_LABELS.get(id)
              const shortcut = parseFloatingShortcut(id)
              if (!target || !shortcut) return null
              const on = shortcut.kind === 'flag' && snapshot.flags[shortcut.target] === true
              const reason = floatingShortcutDisabledReason(id, snapshot, runtime.supports?.(id) ?? true)
              const Icon =
                id.includes('victory') || id === 'flag:autoWin'
                  ? LuTrophy
                  : id.includes('scene:item')
                    ? LuPackage
                    : id === 'flag:autotalk'
                      ? LuMessageCircle
                      : id.includes('battle:party')
                        ? LuHeart
                        : id.includes('Battle') || id.includes('battle:')
                          ? LuSwords
                          : id.startsWith('action:scene:')
                            ? LuPlay
                            : LuZap
              return (
                <div
                  key={id}
                  className="pointer-events-auto absolute motion-safe:animate-[kit-rise_0.18s_ease-out_both]"
                  style={{ left: layout.slots[index]?.x, top: layout.slots[index]?.y, animationDelay: `${index * 18}ms` }}
                >
                  <Button
                    variant="default"
                    className={`shrink-0 rounded-full p-0 shadow-lg backdrop-blur-md focus-visible:ring-2 focus-visible:ring-accent aria-busy:opacity-70 ${on ? 'border-accent bg-accent/15 text-accent' : 'bg-panel/95'}`}
                    style={{ width: FLOATING_SHORTCUT_SIZE, height: FLOATING_SHORTCUT_SIZE }}
                    aria-label={t(target.labelKey)}
                    aria-pressed={shortcut.kind === 'flag' ? on : undefined}
                    tabIndex={-1}
                    disabled={!!reason}
                    aria-disabled={!!reason || pending !== null}
                    aria-busy={pending === id || undefined}
                    tooltip={reason ? `${t(target.labelKey)}: ${t(reason)}` : t(target.labelKey)}
                    onClick={() => {
                      if (!reason && pending === null) void execute(id)
                    }}
                  >
                    <Icon size={20} className="shrink-0" />
                    {shortcut.kind === 'flag' ? <span className="sr-only">{t(on ? 'floatingBall.on' : 'floatingBall.off')}</span> : null}
                  </Button>
                </div>
              )
            })
          ) : (
            <p className="absolute bottom-0 m-0 rounded-lg border border-line bg-panel p-3 text-xs text-ink-soft">{t('floatingBall.empty')}</p>
          )}
          {error ? (
            <p role="alert" className="pointer-events-auto absolute bottom-0 m-0 max-h-20 w-full overflow-auto rounded-lg border border-line bg-panel p-2 text-xs text-fail">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
