'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * 主导航：路径英文与含义对齐
 * - `/game` 游戏库
 * - `/cheat` 修改（局内 GameEdit）
 * - `/translate/run` 翻译动作；`/translate/cache` 翻译库浏览
 * - `/logs` 日志
 * - `/integration/skills` · `/integration/mcp` · `/integration/webmcp` 集成
 * - `/settings/agents` 配置
 * `/` 暂空，重定向到 `/game`
 */
const LINKS = [
  { href: '/game', labelKey: 'nav.library' },
  { href: '/cheat/run', labelKey: 'nav.edit' },
  { href: '/translate/run', labelKey: 'nav.translate' },
  { href: '/logs', labelKey: 'nav.logs' },
  { href: '/integration/skills', labelKey: 'nav.integration' },
  { href: '/settings/agents', labelKey: 'nav.settings' },
] as const satisfies ReadonlyArray<{ href: string; labelKey: MessageKey }>

export type AppNavPath = (typeof LINKS)[number]['href'] | '/cheat' | '/translate' | '/integration' | '/settings'

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

function navActive(current: AppNavPath, href: (typeof LINKS)[number]['href']) {
  if (href === '/cheat/run') return current === '/cheat' || current === '/cheat/run' || current.startsWith('/cheat/')
  if (href === '/translate/run') return current === '/translate' || current === '/translate/run' || current.startsWith('/translate/')
  if (href === '/integration/skills') return current === '/integration' || current.startsWith('/integration/')
  if (href === '/settings/agents') return current === '/settings' || current.startsWith('/settings/')
  if (href === '/game') return current === '/game'
  return current === href
}

/**
 * 顶栏主导航：经典底线样式。
 * hover 只变字色；滑动指示条贴底，需与 `topBarFrame` 的 border-b 重合（导航勿放进 overflow:hidden）。
 */
export function AppNav({ current, className }: { current: AppNavPath; className?: string }) {
  const t = useT()
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<IndicatorState>({ left: 0, width: 0, opacity: 0 })
  const [ready, setReady] = useState(false)

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

  return (
    <nav ref={navRef} aria-label={t('nav.main')} className={cn('relative m-0 flex h-full w-fit shrink-0 items-stretch gap-0 overflow-visible', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-0 z-[1] h-0.5 bg-accent',
          'transition-[left,width,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'
        )}
        style={{ left: indicator.left, width: indicator.width, opacity: indicator.opacity }}
      />
      {LINKS.map((l) => {
        const active = navActive(current, l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
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
            {t(l.labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
