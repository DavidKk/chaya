'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuChevronDown, LuMenu, LuX } from 'react-icons/lu'

import { AI_SECTIONS } from '@/components/ai/ai-sections'
import { EDIT_TABS, editTabHref } from '@/components/game-edit/tabs'
import { useT } from '@/components/i18n/LocaleProvider'
import { ASSIST_SECTIONS } from '@/components/input-assistance/assist-sections'
import { INTEGRATION_TABS } from '@/components/integration/tabs'
import { LOGS_SECTIONS, logsSectionHref } from '@/components/logs/sections'
import { mainNavFor, type MainNavId } from '@/components/main-nav'
import { REMOTE_TABS } from '@/components/remote-play/remote-tabs'
import { Button } from '@/components/sk'
import { useSafeSearchParams } from '@/components/translate/safe-navigation'
import { TRANSLATE_TABS, translateTabHref } from '@/components/translate/tabs'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * 主导航：路径英文与含义对齐
 * - `/game` 游戏库
 * - `/cheat` 修改（局内 GameEdit）
 * - `/translate/run` 翻译动作；`/translate/cache` 翻译库浏览
 * - `/assist/hotkeys` 辅助（`/assist` 也重定向到这里）
 * - `/logs/runtime` · `/logs/agent` · `/logs/cli` 日志（二级一律斜杠）
 * - `/integration/mcp` · `/integration/webmcp` · `/integration/openapi` 集成
 * `/` 暂空，重定向到 `/game`
 */
type AppNavChild = { href: string; labelKey: MessageKey }
type AppNavItem = { id: MainNavId; href: string; labelKey: MessageKey; children?: ReadonlyArray<AppNavChild> }
type AppNavRoute = Pick<AppNavItem, 'href' | 'children'>

/** 网页端各模块的入口；顺序与名称来自 `MAIN_NAV` */
const WEB_ROUTES: Partial<Record<MainNavId, AppNavRoute>> = {
  library: { href: '/game' },
  edit: { href: '/cheat/run', children: EDIT_TABS.map((item) => ({ href: editTabHref(item.id), labelKey: item.labelKey })) },
  translate: { href: '/translate/seed', children: TRANSLATE_TABS.map((item) => ({ href: translateTabHref(item.id), labelKey: item.labelKey })) },
  assist: { href: '/assist/hotkeys', children: ASSIST_SECTIONS.map((section) => ({ href: `/assist/${section.id}`, labelKey: section.labelKey })) },
  ai: { href: '/ai/companion', children: AI_SECTIONS.map((section) => ({ href: `/ai/${section.id}`, labelKey: section.labelKey })) },
  remote: { href: '/remote/instances', children: REMOTE_TABS.map((tab) => ({ href: tab.href, labelKey: tab.labelKey })) },
  integration: { href: '/integration/mcp', children: INTEGRATION_TABS },
  logs: {
    href: logsSectionHref('runtime'),
    children: LOGS_SECTIONS.map((section) => ({ href: logsSectionHref(section.id), labelKey: section.labelKey })),
  },
}

export const APP_NAV_ITEMS: ReadonlyArray<AppNavItem> = mainNavFor('web').flatMap((item) => {
  const route = WEB_ROUTES[item.id]
  return route ? [{ id: item.id, labelKey: item.labelKey, ...route }] : []
})

export type AppNavPath =
  | '/game'
  | '/ai'
  | '/ai/companion'
  | '/ai/roles'
  | '/ai/agents'
  | '/assist'
  | '/cheat/run'
  | '/translate/seed'
  | '/translate/run'
  | '/logs'
  | '/logs/runtime'
  | '/integration/mcp'
  | '/integration/webmcp'
  | '/integration/openapi'
  | '/integration/skills'
  | '/cheat'
  | '/translate'
  | '/integration'
  | '/settings'
  | '/remote'
  | '/remote/instances'
  | '/remote/settings'

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

const GAME_RELATED_SECTIONS = new Set<MainNavId>(['library', 'edit', 'translate', 'ai', 'assist', 'remote'])

function withGameQuery(href: string, gameId: string | null): string {
  if (!gameId) return href
  const [base, query] = href.split('?')
  const params = new URLSearchParams(query || '')
  params.set('game', gameId)
  return `${base}?${params.toString()}`
}

function navActive(current: AppNavPath, href: string) {
  const cleanHref = href.split('?')[0]
  if (cleanHref === '/cheat/run') return current === '/cheat' || current === '/cheat/run' || current.startsWith('/cheat/')
  if (cleanHref === '/translate/seed' || cleanHref === '/translate/run')
    return current === '/translate' || current === '/translate/seed' || current === '/translate/run' || current.startsWith('/translate/')
  if (cleanHref.startsWith('/ai/')) return current === '/ai' || current.startsWith('/ai')
  if (cleanHref.startsWith('/integration/')) return current === '/integration' || current.startsWith('/integration/')
  if (cleanHref === '/game') return current === '/game'
  if (cleanHref.startsWith('/remote')) return current === '/remote' || current.startsWith('/remote')
  if (cleanHref === '/assist/hotkeys') return current === '/assist' || current === '/settings'
  if (cleanHref.startsWith('/logs')) return current === '/logs' || current.startsWith('/logs')
  return current === cleanHref
}

function childActive(pathname: string, href: string) {
  const target = new URL(href, 'http://chaya.local')
  return pathname === target.pathname || pathname.startsWith(`${target.pathname}/`)
}

/**
 * 顶栏主导航：经典底线样式。
 * hover 只变字色；滑动指示条贴底，需与 `topBarFrame` 的 border-b 重合（导航勿放进 overflow:hidden）。
 */
export function AppNav({
  current,
  className,
  mobileActions,
  mobileFooter,
  mobileEnd,
}: {
  current: AppNavPath
  className?: string
  mobileActions?: ReactNode
  mobileFooter?: ReactNode
  mobileEnd?: ReactNode
}) {
  const t = useT()
  const pathname = usePathname() || ''
  const searchParams = useSafeSearchParams()
  const urlGameId = searchParams?.get('game') || ''

  const navItems = useMemo(() => {
    return APP_NAV_ITEMS.map((item) => {
      const isGameRelated = GAME_RELATED_SECTIONS.has(item.id)
      const href = isGameRelated && urlGameId ? withGameQuery(item.href, urlGameId) : item.href
      const children = item.children?.map((child) => ({
        ...child,
        href: isGameRelated && urlGameId ? withGameQuery(child.href, urlGameId) : child.href,
      }))
      return { ...item, href, children }
    })
  }, [urlGameId])

  const navRef = useRef<HTMLElement>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement>(null)
  const mobilePanelRef = useRef<HTMLDivElement>(null)
  const mobileTitleId = useId()
  const [indicator, setIndicator] = useState<IndicatorState>({ left: 0, width: 0, opacity: 0 })
  const [ready, setReady] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())

  const closeMobileNav = useCallback(() => {
    setMobileOpen(false)
    window.requestAnimationFrame(() => mobileTriggerRef.current?.focus())
  }, [])

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

    const active = navItems.find((item) => navActive(current, item.href))
    setExpandedIds(active?.children?.length ? new Set([active.id]) : new Set())

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (event.isComposing || event.keyCode === 229) return
        event.preventDefault()
        closeMobileNav()
        return
      }
      if (event.key !== 'Tab' || !mobilePanelRef.current?.contains(document.activeElement)) return
      const focusable = Array.from(
        mobilePanelRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')
      ).filter((element) => !element.hidden)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
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
  }, [closeMobileNav, current, mobileOpen, navItems])

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
        className="self-center md:hidden"
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
        {navItems.map((item) => {
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
                <div className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-3">
                  <h2 id={mobileTitleId} className="m-0 text-sm font-semibold text-ink">
                    {t('nav.menu')}
                  </h2>
                  {mobileEnd ? (
                    <div className="ml-auto flex items-center" onClick={closeMobileNav}>
                      {mobileEnd}
                    </div>
                  ) : (
                    <span className="ml-auto" />
                  )}
                  <Button variant="ghost" size="icon" aria-label={t('nav.closeMenu')} tooltip={t('nav.closeMenu')} onClick={closeMobileNav}>
                    <LuX size={18} aria-hidden />
                  </Button>
                </div>
                <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label={t('nav.main')}>
                  {mobileActions ? <div className="mb-1 flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-1 pb-2">{mobileActions}</div> : null}
                  {navItems.map((item) => {
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
                {mobileFooter ? (
                  <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    {mobileFooter}
                  </footer>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
