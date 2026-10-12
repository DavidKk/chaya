'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuBlend } from 'react-icons/lu'

import { resolvePortalRoot } from '@/components/game-edit/resolvePortalRoot'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { useFloatingPanel } from '@/components/sk/useFloatingPanel'
import type { ToolSettings } from '@/lib/game-agent/tool-settings'
import { cn } from '@/lib/utils'

import type { ToolSettingsPatch } from './useToolSettings'

export type MiniPanelOpacitySettings = { settings: ToolSettings; update: (patch: ToolSettingsPatch) => Promise<unknown> }
type Props = { settings: MiniPanelOpacitySettings; placement?: 'right' | 'bottom' }
export function MiniPanelOpacityControl({ settings, placement = 'bottom' }: Props) {
  const t = useT()
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(40)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const panelStyle = useFloatingPanel({ open, anchorRef: rootRef, panelRef, widthMode: 'content', maxHeight: 80 })

  useEffect(() => setDraft(settings.settings.miniPanelOpacity), [settings.settings.miniPanelOpacity])
  useEffect(() => {
    const value = String(settings.settings.miniPanelOpacity / 100)
    rootRef.current?.closest<HTMLElement>('[aria-label][data-pinned]')?.style.setProperty('--mini-panel-opacity', value)
    const root = rootRef.current?.getRootNode()
    ;(root instanceof ShadowRoot ? root.querySelector<HTMLElement>('[data-mini-panel-root]') : document.documentElement)?.style.setProperty('--mini-panel-opacity', value)
  }, [settings.settings.miniPanelOpacity])
  useEffect(() => {
    if (!open) return
    setPortalRoot(resolvePortalRoot(rootRef.current))
    const close = () => {
      setOpen(false)
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const path = event.composedPath()
      if (path.some((node) => node === rootRef.current || node === panelRef.current || (node instanceof Node && panelRef.current?.contains(node)))) return
      close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const preview = (next: number) => {
    setDraft(next)
    const root = rootRef.current?.getRootNode()
    const value = String(next / 100)
    rootRef.current?.closest<HTMLElement>('[aria-label][data-pinned]')?.style.setProperty('--mini-panel-opacity', value)
    ;(root instanceof ShadowRoot ? root.querySelector<HTMLElement>('[data-mini-panel-root]') : document.documentElement)?.style.setProperty('--mini-panel-opacity', value)
  }

  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <Button
        ref={triggerRef}
        size="mini"
        variant="plain"
        className={cn('[@media(hover:none)]:h-11 [@media(hover:none)]:w-11', open && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
        tooltipSuppressed={open}
        tooltipPlacement={placement}
        aria-label={t('panels.bar.opacity')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <LuBlend size={13} aria-hidden />
      </Button>
      {open && portalRoot
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={t('panels.bar.opacity')}
              data-panel-interaction-active=""
              className="z-[70] flex w-48 items-center gap-2 rounded-[0.25rem] border border-line bg-[var(--panel-2)] px-3 py-2 text-ink shadow-[0_12px_32px_rgb(0_0_0/0.35)]"
              style={panelStyle}
            >
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={draft}
                className="min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
                aria-label={t('panels.bar.opacity')}
                aria-valuetext={t('panels.bar.opacityValue', { value: draft })}
                onChange={(event) => preview(Number(event.currentTarget.value))}
                onPointerUp={(event) => void settings.update({ miniPanelOpacity: Number(event.currentTarget.value) })}
                onKeyUp={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
                    void settings.update({ miniPanelOpacity: Number(event.currentTarget.value) })
                }}
              />
              <output className="w-9 shrink-0 text-right font-mono text-xs text-ink-soft" aria-live="polite">
                {draft}%
              </output>
            </div>,
            portalRoot
          )
        : null}
    </span>
  )
}
