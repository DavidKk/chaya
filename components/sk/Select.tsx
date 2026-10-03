'use client'

import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoCheckmark, IoChevronDown } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { FORM_CONTROL_H, formControlChrome, formControlPadX } from '@/components/sk/control'
import { ScrollArea } from '@/components/sk/ScrollArea'
import { type FloatingPanelWidthMode, useFloatingPanel } from '@/components/sk/useFloatingPanel'
import { cn } from '@/lib/utils'

const PANEL_MAX_HEIGHT_PX = 224

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

export type SelectProps = {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  /** anchor：与触发器等宽；content：按选项内容收缩（不撑开锚点） */
  panelWidth?: FloatingPanelWidthMode
}

export function Select({ id, value, options, onChange, placeholder, emptyLabel, disabled = false, className, 'aria-label': ariaLabel, panelWidth = 'anchor' }: SelectProps) {
  const t = useT()
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder')
  const resolvedEmptyLabel = emptyLabel ?? t('common.emptyOptions')
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [mounted, setMounted] = useState(false)

  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? resolvedPlaceholder
  const panelStyle = useFloatingPanel({
    open,
    anchorRef: rootRef,
    panelRef,
    maxHeight: PANEL_MAX_HEIGHT_PX,
    widthMode: panelWidth,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setHighlight(-1)
  }, [])

  const openPanel = useCallback(() => {
    if (disabled) return
    const idx = options.findIndex((o) => o.value === value && !o.disabled)
    setHighlight(idx >= 0 ? idx : options.findIndex((o) => !o.disabled))
    setOpen(true)
  }, [disabled, options, value])

  const pick = useCallback(
    (index: number) => {
      const opt = options[index]
      if (!opt || opt.disabled) return
      onChange(opt.value)
      close()
      triggerRef.current?.focus()
    },
    [close, onChange, options]
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open])

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) openPanel()
      else if (e.key === 'Enter' || e.key === ' ') pick(highlight)
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setHighlight((h) => {
        for (let i = h - 1; i >= 0; i -= 1) {
          if (!options[i]?.disabled) return i
        }
        return h
      })
    } else if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      setHighlight((h) => {
        for (let i = h + 1; i < options.length; i += 1) {
          if (!options[i]?.disabled) return i
        }
        return h
      })
    }
  }

  const rootNode = rootRef.current?.getRootNode()
  const portalContainer = typeof document === 'undefined' ? null : typeof ShadowRoot !== 'undefined' && rootNode instanceof ShadowRoot ? rootNode : document.body
  const panel =
    open && mounted && portalContainer
      ? createPortal(
          <div
            ref={panelRef}
            className={cn(
              'fixed z-[60] flex flex-col overflow-hidden rounded-[0.2rem] border border-line bg-[var(--panel-2)] shadow-[0_12px_32px_rgb(0_0_0/0.35)]',
              panelWidth === 'content' && 'w-max'
            )}
            style={{ ...panelStyle, maxHeight: PANEL_MAX_HEIGHT_PX }}
            data-listbox-panel=""
          >
            <ScrollArea
              className="min-h-0 flex-1"
              indicator="vertical"
              reserveGutter={false}
              scrollProps={{
                id: listboxId,
                role: 'listbox',
                tabIndex: -1,
                'aria-label': ariaLabel,
              }}
            >
              <div className="m-0 list-none p-0.5">
                {options.length === 0 ? (
                  <div className="p-2 text-xs text-ink-soft" role="status">
                    {resolvedEmptyLabel}
                  </div>
                ) : (
                  options.map((opt, index) => {
                    const isSelected = opt.value === value
                    const isHi = index === highlight
                    return (
                      <div
                        key={opt.value}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={opt.disabled || undefined}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-2 rounded-[0.12rem] px-2 py-2 text-[0.8125rem] text-ink',
                          panelWidth === 'content' && 'whitespace-nowrap',
                          isSelected && 'text-accent',
                          isHi && 'bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]',
                          opt.disabled && 'cursor-not-allowed opacity-40'
                        )}
                        onMouseEnter={() => !opt.disabled && setHighlight(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(index)}
                      >
                        <span>{opt.label}</span>
                        {isSelected ? <IoCheckmark size={14} aria-hidden className="shrink-0 text-accent" /> : null}
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </div>,
          portalContainer
        )
      : null

  return (
    <div ref={rootRef} className={cn('relative inline-block min-w-0', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={cn(
          formControlChrome,
          formControlPadX,
          FORM_CONTROL_H,
          'inline-flex w-full cursor-pointer items-center justify-between gap-2',
          'hover:enabled:border-[rgb(230_238_248/0.2)]',
          'focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-45',
          open && 'border-accent'
        )}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKey}
      >
        <span className={cn(!selected && 'text-ink-soft')}>{label}</span>
        <IoChevronDown className="shrink-0 text-ink-soft" size={14} aria-hidden />
      </button>
      {panel}
    </div>
  )
}
