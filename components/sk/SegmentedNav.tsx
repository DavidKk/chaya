'use client'

import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { FORM_CONTROL_H } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export type SegmentedNavItem<T extends string> = {
  id: T
  label: string
  /** 有 icon 时展示图标，label 作 aria / tooltip */
  icon?: ReactNode
  /** 对应内容面板；提供时自动关联 tab / tabpanel。 */
  panelId?: string
}

export type SegmentedNavProps<T extends string> = {
  items: readonly SegmentedNavItem<T>[]
  value: T
  onChange: (id: T) => void
  'aria-label': string
  className?: string
}

const LINK_SELECTOR = '[data-header-nav-link]'

type IndicatorState = { left: number; width: number; opacity: number }

function measureIndicator(nav: HTMLElement, target: HTMLElement): IndicatorState {
  const navRect = nav.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return {
    left: Math.round(targetRect.left - navRect.left + nav.scrollLeft - nav.clientLeft),
    width: Math.round(targetRect.width),
    opacity: 1,
  }
}

/** 工单 SegmentedHeaderNav + HeaderNavIndicator 同款交互：凹槽底、滑动指示、hover/focus 跟随 */
export function SegmentedNav<T extends string>({ items, value, onChange, 'aria-label': ariaLabel, className }: SegmentedNavProps<T>) {
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<IndicatorState>({ left: 0, width: 0, opacity: 0 })
  const [ready, setReady] = useState(false)

  const syncToActive = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const active = nav.querySelector<HTMLElement>(`${LINK_SELECTOR}[data-nav-id="${CSS.escape(value)}"]`)
    if (!active) {
      setIndicator((prev) => ({ ...prev, opacity: 0 }))
      return
    }
    setIndicator(measureIndicator(nav, active))
  }, [value])

  useLayoutEffect(() => {
    syncToActive()
    setReady(true)
  }, [syncToActive, items])

  useEffect(() => {
    const nav = navRef.current
    if (!nav || !ready) return
    const navElement = nav

    function handlePointerOver(event: PointerEvent) {
      const link = (event.target as HTMLElement).closest<HTMLElement>(LINK_SELECTOR)
      if (!link || !navElement.contains(link)) return
      setIndicator(measureIndicator(navElement, link))
    }

    function handlePointerLeave() {
      syncToActive()
    }

    function handleFocusIn(event: FocusEvent) {
      const link = (event.target as HTMLElement).closest<HTMLElement>(LINK_SELECTOR)
      if (link && navElement.contains(link)) {
        setIndicator(measureIndicator(navElement, link))
      }
    }

    function handleFocusOut() {
      window.requestAnimationFrame(() => {
        if (!navElement.contains(document.activeElement)) {
          syncToActive()
        }
      })
    }

    function handleResize() {
      syncToActive()
    }

    navElement.addEventListener('pointerover', handlePointerOver)
    navElement.addEventListener('pointerleave', handlePointerLeave)
    navElement.addEventListener('focusin', handleFocusIn)
    navElement.addEventListener('focusout', handleFocusOut)
    window.addEventListener('resize', handleResize)

    return () => {
      navElement.removeEventListener('pointerover', handlePointerOver)
      navElement.removeEventListener('pointerleave', handlePointerLeave)
      navElement.removeEventListener('focusin', handleFocusIn)
      navElement.removeEventListener('focusout', handleFocusOut)
      window.removeEventListener('resize', handleResize)
    }
  }, [ready, syncToActive])

  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative box-border flex w-fit max-w-none shrink-0 items-center gap-0.5 overflow-hidden rounded-[0.2rem] border border-line p-0.5',
        FORM_CONTROL_H,
        'bg-[color-mix(in_oklab,var(--inset)_88%,var(--panel))]',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0.5 bottom-0.5 z-0 rounded-[0.15rem] bg-panel',
          'shadow-[0_1px_2px_rgb(0_0_0/0.28)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--line)_70%,transparent)]',
          'transition-[left,width,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'
        )}
        style={{ left: indicator.left, width: indicator.width, opacity: indicator.opacity }}
      />
      {items.map((item) => {
        const active = item.id === value
        const iconOnly = !!item.icon
        const btn = (
          <button
            type="button"
            role="tab"
            data-header-nav-link=""
            data-nav-id={item.id}
            aria-label={item.label}
            aria-selected={active}
            id={item.panelId ? `${item.panelId}-tab` : undefined}
            aria-controls={item.panelId}
            tabIndex={active ? 0 : -1}
            className={cn(
              'relative z-[1] inline-flex h-full min-h-0 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[0.15rem] border-0 bg-transparent',
              'text-[0.8125rem] font-medium leading-none text-ink-soft no-underline transition-colors hover:text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]',
              iconOnly ? 'w-8 px-0' : 'px-3',
              active && 'text-accent'
            )}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              const index = items.findIndex((candidate) => candidate.id === item.id)
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % items.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + items.length) % items.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : -1
              if (next < 0) return
              event.preventDefault()
              onChange(items[next].id)
              navRef.current?.querySelectorAll<HTMLButtonElement>(LINK_SELECTOR)[next]?.focus({ preventScroll: true })
            }}
          >
            {iconOnly ? <span className="inline-flex size-[1.05rem] items-center justify-center [&_svg]:size-full">{item.icon}</span> : item.label}
          </button>
        )
        return iconOnly ? (
          <Tooltip key={item.id} content={item.label}>
            {btn}
          </Tooltip>
        ) : (
          <Fragment key={item.id}>{btn}</Fragment>
        )
      })}
    </nav>
  )
}
