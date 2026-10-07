'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuChevronDown, LuMenu, LuX } from 'react-icons/lu'

import { EDIT_TABS, editTabHref } from '@/components/game-edit/tabs'
import { useT } from '@/components/i18n/LocaleProvider'
import { ASSIST_SECTIONS } from '@/components/input-assistance/assist-sections'
import { INTEGRATION_TABS } from '@/components/integration/tabs'
import { Button } from '@/components/sk'
import { TRANSLATE_TABS, translateTabHref } from '@/components/translate/tabs'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * 主导航：路径英文与含义对齐
 * - `/game` 游戏库
 * - `/cheat` 修改（局内 GameEdit）
 * - `/translate/run` 翻译动作；`/translate/cache` 翻译库浏览
 * - `/assist/hotkeys` 辅助（`/assist` 也重定向到这里）
 * - `/logs` 日志
 * - `/integration/skills` · `/integration/mcp` · `/integration/webmcp` 集成
 * `/` 暂空，重定向到 `/game`
 */
type AppNavChild = { href: string; labelKey: MessageKey }
type AppNavItem = { id: string; href: string; labelKey: MessageKey; children?: ReadonlyArray<AppNavChild> }

export const APP_NAV_ITEMS: ReadonlyArray<AppNavItem> = [
  { id: 'library', href: '/game', labelKey: 'nav.library' },
  {
    id: 'edit',
    href: '/cheat/run',
    labelKey: 'nav.edit',
    children: EDIT_TABS.map((item) => ({ href: editTabHref(item.id), labelKey: item.labelKey })),
  },
  {
    id: 'translate',
    href: '/translate/run',
    labelKey: 'nav.translate',
    children: TRANSLATE_TABS.map((item) => ({ href: translateTabHref(item.id), labelKey: item.labelKey })),
  },
  {
    id: 'assist',
    href: '/assist/hotkeys',
    labelKey: 'nav.assist',
    children: ASSIST_SECTIONS.map((section) => ({ href: `/assist/${section.id}`, labelKey: section.labelKey })),
  },
  { id: 'logs', href: '/logs', labelKey: 'nav.logs' },
  { id: 'integration', href: '/integration/skills', labelKey: 'nav.integration', children: INTEGRATION_TABS },
] as const

export type AppNavPath = '/game' | '/assist' | '/cheat/run' | '/translate/run' | '/logs' | '/integration/skills' | '/cheat' | '/translate' | '/integration' | '/settings'

const LINK_SELECTOR = '[data-app-nav-link]'

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

function navActive(current: AppNavPath, href: string) {
  if (href === '/cheat/run') return current === '/cheat' || current === '/cheat/run' || current.startsWith('/cheat/')
  if (href === '/translate/run') return current === '/translate' || current === '/translate/run' || current.startsWith('/translate/')
  if (href === '/integration/skills') return current === '/integration' || current.startsWith('/integration/')
  if (href === '/game') return current === '/game'
  if (href === '/assist/hotkeys') return current === '/assist' || current === '/settings'
  return current === href
}

function childActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * 顶栏主导航：经典底线样式。
 * hover 只变字色；滑动指示条贴底，需与 `topBarFrame` 的 border-b 重合（导航勿放进 overflow:hidden）。
 */
export function AppNav({ current, className, mobileActions, mobileEnd }: { current: AppNavPath; className?: string; mobileActions?: ReactNode; mobileEnd?: ReactNode }) {
  const t = useT()
  const pathname = usePathname() || ''
  const navRef = useRef<HTMLElement>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement>(null)
  const mobilePanelRef = useRef<HTMLDivElement>(null)
  const mobileTitleId = useId()
  const [indicator, setIndicator] = useState<IndicatorState>({ left: 0, width: 0, opacity: 0 })
  const [ready, setReady] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())

  const syncToActive = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const active = nav.querySelector<HTMLElement>(`${LINK_SELECTOR}[data-active="true"]`)
    if (!active) {
      setIndicator((prev) => ({ ...prev, opacity: 0 }))
      return
    }
    setIndicator(measureIndicator(nav, active))
  }, [])

  useLayoutEffect(() => {
    syncToActive()
    setReady(true)
  }, [syncToActive, current])

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

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return

    const active = APP_NAV_ITEMS.find((item) => navActive(current, item.href))
    setExpandedIds(active?.children?.length ? new Set([active.id]) : new Set())

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMobileOpen(false)
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    const frame = window.requestAnimationFrame(() => {
      mobilePanelRef.current?.querySelector<HTMLElement>('a[aria-current="page"], button[aria-expanded="true"], a')?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [current, mobileOpen])

  function closeMobileNav() {
    setMobileOpen(false)
    window.requestAnimationFrame(() => mobileTriggerRef.current?.focus())
  }

  function toggleSection(id: string) {
    setExpandedIds((currentIds) => {
      const next = new Set(currentIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <Button
        ref={mobileTriggerRef}
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t('nav.openMenu')}
        aria-expanded={mobileOpen}
        aria-controls="app-mobile-nav"
        tooltip={t('nav.openMenu')}
        onClick={() => setMobileOpen(true)}
      >
        <LuMenu size={18} aria-hidden />
      </Button>

      <nav ref={navRef} aria-label={t('nav.main')} className={cn('relative m-0 hidden h-full w-fit shrink-0 items-stretch gap-0 overflow-visible md:flex', className)}>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-0 z-[1] h-0.5 bg-accent',
            'transition-[left,width,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'
          )}
          style={{ left: indicator.left, width: indicator.width, opacity: indicator.opacity }}
        />
        {APP_NAV_ITEMS.map((item) => {
          const active = navActive(current, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              data-app-nav-link=""
              data-active={active}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative z-0 inline-flex h-full items-center justify-center whitespace-nowrap border-0 bg-transparent px-3',
                'text-[0.9375rem] font-semibold leading-none text-ink-soft no-underline shadow-none outline-none',
                'transition-colors duration-150 hover:text-ink',
                'focus-visible:text-ink focus-visible:outline-none',
                active && 'text-ink'
              )}
            >
              {t(item.labelKey)}
            </Link>
          )
        })}
      </nav>

      {mobileOpen && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[60] md:hidden" data-app-mobile-nav>
              <button type="button" className="absolute inset-0 border-0 bg-black/45" aria-label={t('nav.closeMenu')} onClick={closeMobileNav} />
              <div
                ref={mobilePanelRef}
                id="app-mobile-nav"
                role="dialog"
                aria-modal="true"
                aria-labelledby={mobileTitleId}
                className="absolute inset-y-0 right-0 flex w-[min(calc(100vw-3rem),20rem)] flex-col border-l border-line bg-paper-2 shadow-2xl"
              >
                <div className="flex h-[3.25rem] shrink-0 items-center justify-between gap-2 border-b border-line px-3">
                  <h2 id={mobileTitleId} className="m-0 text-sm font-semibold text-ink">
                    {t('nav.menu')}
                  </h2>
                  <Button variant="ghost" size="icon" aria-label={t('nav.closeMenu')} tooltip={t('nav.closeMenu')} onClick={closeMobileNav}>
                    <LuX size={18} aria-hidden />
                  </Button>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-3">
                  {mobileActions}
                  {mobileEnd ? (
                    <div className="ml-auto" onClick={closeMobileNav}>
                      {mobileEnd}
                    </div>
                  ) : null}
                </div>
                <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label={t('nav.main')}>
                  {APP_NAV_ITEMS.map((item) => {
                    const active = navActive(current, item.href)
                    if (!item.children?.length) {
                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'rounded-[0.35rem] px-3 py-2.5 text-sm font-medium text-ink-soft no-underline transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-ink',
                            active && 'bg-[color-mix(in_oklab,var(--accent)_13%,transparent)] text-accent'
                          )}
                          onClick={closeMobileNav}
                        >
                          {t(item.labelKey)}
                        </Link>
                      )
                    }

                    const expanded = expandedIds.has(item.id)
                    const panelId = `app-mobile-nav-${item.id}`
                    return (
                      <div key={item.id} className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          className={cn(
                            'flex w-full cursor-pointer items-center justify-between gap-2 rounded-[0.35rem] border-0 bg-transparent px-3 py-2.5 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-ink',
                            active && 'text-accent'
                          )}
                          onClick={() => toggleSection(item.id)}
                        >
                          <span>{t(item.labelKey)}</span>
                          <LuChevronDown size={16} className={cn('shrink-0 opacity-70 transition-transform', expanded && 'rotate-180')} aria-hidden />
                        </button>
                        {expanded ? (
                          <div id={panelId} className="flex flex-col gap-0.5 pb-1">
                            {item.children.map((child) => {
                              const activeChild = childActive(pathname, child.href)
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  aria-current={activeChild ? 'page' : undefined}
                                  className={cn(
                                    'rounded-[0.35rem] px-3 py-2 pl-5 text-sm font-medium text-ink-soft no-underline transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-ink',
                                    activeChild && 'bg-[color-mix(in_oklab,var(--accent)_13%,transparent)] text-accent'
                                  )}
                                  onClick={closeMobileNav}
                                >
                                  {t(child.labelKey)}
                                </Link>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </nav>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
