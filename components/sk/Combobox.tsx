'use client'

import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoCheckmark, IoChevronDown } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { ScrollArea } from '@/components/sk/ScrollArea'
import { type SelectOption } from '@/components/sk/Select'
import { Spinner } from '@/components/sk/Spinner'
import { TextInput } from '@/components/sk/TextInput'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { type FloatingPanelWidthMode, useFloatingPanel } from '@/components/sk/useFloatingPanel'
import { cn } from '@/lib/utils'

const PANEL_MAX_HEIGHT_PX = 224

export type ComboboxProps = {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Fired when the user picks a suggestion (not free typing). */
  onSelectOption?: (value: string) => void
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  tooltip?: string
  panelWidth?: FloatingPanelWidthMode
  onOpen?: () => void
  loading?: boolean
}

function optionMatches(option: SelectOption, needle: string) {
  if (!needle) return true
  return `${option.label}\n${option.value}`.toLocaleLowerCase().includes(needle)
}

/** Rank matches first; never drop options so the full catalog stays visible. */
function rankOptions(options: SelectOption[], needle: string) {
  if (!needle) return options
  const matched: SelectOption[] = []
  const rest: SelectOption[] = []
  for (const option of options) {
    if (optionMatches(option, needle)) matched.push(option)
    else rest.push(option)
  }
  return matched.length ? [...matched, ...rest] : options
}

/** Text input with suggestion ranking; free typing stays allowed. */
export function Combobox({
  id,
  value,
  options,
  onChange,
  onSelectOption,
  placeholder,
  emptyLabel,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  tooltip,
  panelWidth = 'anchor',
  onOpen,
  loading = false,
}: ComboboxProps) {
  const t = useT()
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder')
  const resolvedEmptyLabel = emptyLabel ?? t('common.emptyOptions')
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [mounted, setMounted] = useState(false)

  const needle = value.trim().toLocaleLowerCase()
  const visibleOptions = useMemo(() => rankOptions(options, needle), [needle, options])
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
    setOpen(true)
    onOpen?.()
  }, [disabled, onOpen])

  useEffect(() => {
    if (!open) return
    setHighlight(visibleOptions.findIndex((option) => !option.disabled))
  }, [open, visibleOptions])

  const pick = useCallback(
    (index: number) => {
      const opt = visibleOptions[index]
      if (!opt || opt.disabled) return
      onChange(opt.value)
      onSelectOption?.(opt.value)
      close()
      inputRef.current?.focus()
    },
    [close, onChange, onSelectOption, visibleOptions]
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      const path = typeof e.composedPath === 'function' ? e.composedPath() : []
      const inPath = (node: Node | null) => Boolean(node && (node.contains(target) || path.includes(node)))
      if (inPath(rootRef.current) || inPath(panelRef.current)) return
      close()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open])

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!open) openPanel()
    onChange(event.target.value)
  }

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openPanel()
      else
        setHighlight((current) => {
          for (let index = current + 1; index < visibleOptions.length; index += 1) if (!visibleOptions[index]?.disabled) return index
          return current
        })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return
      setHighlight((current) => {
        for (let index = current - 1; index >= 0; index -= 1) if (!visibleOptions[index]?.disabled) return index
        return current
      })
    } else if (event.key === 'Enter') {
      if (!open || highlight < 0) return
      event.preventDefault()
      pick(highlight)
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
              panelWidth === 'content' ? 'w-max min-w-full' : 'w-full'
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
                {loading ? (
                  <div className="flex items-center gap-2 p-2 text-xs text-ink-soft" role="status">
                    <Spinner size="sm" />
                    {t('common.loading')}
                  </div>
                ) : null}
                {loading && visibleOptions.length === 0 ? null : visibleOptions.length === 0 ? (
                  <div className="p-2 text-xs text-ink-soft" role="status">
                    {resolvedEmptyLabel}
                  </div>
                ) : (
                  visibleOptions.map((opt, index) => {
                    const isSelected = opt.value === value
                    const isHi = index === highlight
                    return (
                      <div
                        key={opt.value || `opt-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={opt.disabled || undefined}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-2 rounded-[0.12rem] px-2 py-2 text-[0.8125rem] whitespace-nowrap text-ink',
                          isSelected && 'text-accent',
                          isHi && 'bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]',
                          opt.disabled && 'pointer-events-none opacity-45'
                        )}
                        onMouseEnter={() => !opt.disabled && setHighlight(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(index)}
                      >
                        <span className={cn('min-w-0', panelWidth === 'content' ? 'whitespace-nowrap' : 'truncate')}>{opt.label}</span>
                        <span className="inline-flex size-[14px] shrink-0 items-center justify-center" aria-hidden>
                          {isSelected ? <IoCheckmark size={14} className="text-accent" /> : null}
                        </span>
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
      <Tooltip content={tooltip} suppressed={open}>
        <span className="relative inline-flex w-full">
          <TextInput
            ref={inputRef}
            id={id}
            value={value}
            disabled={disabled}
            fullWidth
            placeholder={resolvedPlaceholder}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={ariaLabel}
            className={cn('pr-8', open && 'border-accent')}
            onChange={onInputChange}
            onFocus={() => openPanel()}
            onKeyDown={onInputKey}
            onClick={() => {
              if (!open) openPanel()
            }}
          />
          <IoChevronDown className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-soft" size={14} aria-hidden />
        </span>
      </Tooltip>
      {panel}
    </div>
  )
}
