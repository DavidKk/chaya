'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoSearchOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, TextInput } from '@/components/sk'
import { useFloatingPanel } from '@/components/sk/useFloatingPanel'

import { resolvePortalRoot } from './resolvePortalRoot'

type Props = { value: string; onChange: (value: string) => void }

/** 搜索入口固定在筛选轨左侧；工具栏过窄时输入框转为可展开的图标。 */
export function GameEditSearch({ value, onChange }: Props) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const [compact, setCompact] = useState(false)
  const [open, setOpen] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const panelStyle = useFloatingPanel({ open: compact && open, anchorRef: rootRef, panelRef, widthMode: 'content' })

  useEffect(() => {
    const toolbar = rootRef.current?.parentElement
    if (!toolbar || typeof ResizeObserver === 'undefined') return
    const sync = () => setCompact(toolbar.getBoundingClientRect().width < 420)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!compact) setOpen(false)
  }, [compact])

  useEffect(() => {
    if (!open || !compact) return
    setPortalRoot(resolvePortalRoot(rootRef.current))
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (path.some((node) => node === rootRef.current || node === panelRef.current || (node instanceof Node && panelRef.current?.contains(node)))) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [compact, open])

  useEffect(() => {
    if (compact && open && portalRoot) inputRef.current?.focus()
  }, [compact, open, portalRoot])

  return (
    <div ref={rootRef} className={compact ? 'shrink-0' : 'min-w-8 max-w-[11rem] flex-[0_1_11rem]'}>
      {compact ? (
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          tooltip=""
          title={t('edit.search')}
          className={value ? 'text-accent' : undefined}
          aria-label={t('edit.search')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <IoSearchOutline size={17} aria-hidden />
        </Button>
      ) : (
        <TextInput
          search
          type="search"
          className="h-8 w-full min-w-0 text-[0.8125rem]"
          value={value}
          placeholder={t('edit.searchPh')}
          aria-label={t('edit.search')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {compact && open && portalRoot
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={t('edit.searchNameId')}
              className="z-[70] w-[min(17rem,calc(100vw-1rem))] rounded-[0.2rem] border border-line bg-[var(--panel-2)] p-2 shadow-[0_12px_32px_rgb(0_0_0/0.35)]"
              style={panelStyle}
            >
              <TextInput
                ref={inputRef}
                search
                type="search"
                className="w-full"
                value={value}
                placeholder={t('edit.searchPh')}
                aria-label={t('edit.searchNameId')}
                onChange={(event) => onChange(event.target.value)}
              />
            </div>,
            portalRoot
          )
        : null}
    </div>
  )
}
