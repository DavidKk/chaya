'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GiHamburgerMenu } from 'react-icons/gi'
import { IoCheckmark } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { SegmentedNav } from '@/components/sk'
import { FORM_CONTROL_H, formControlChrome } from '@/components/sk/control'
import { useFloatingPanel } from '@/components/sk/useFloatingPanel'
import { cn } from '@/lib/utils'

import { resolvePortalRoot } from './resolvePortalRoot'
import { TAB_ICONS } from './tab-icons'
import { type GameEditSurface, type TabId, tabsForSurface } from './tabs'

type Density = 'label' | 'icon' | 'menu'

/** 按编辑头可用宽度：大屏文案 · 中屏图标 · 手机菜单 */
function densityFromWidth(width: number): Density {
  if (width < 520) return 'menu'
  if (width < 1120) return 'icon'
  return 'label'
}

type Props = {
  tab: TabId
  setTab: (tab: TabId) => void
  surface: GameEditSurface
}

type TabDef = ReturnType<typeof tabsForSurface>[number]

/** 手机档：图标按钮 + 下拉菜单（非 Select） */
function TabIconMenu({ tab, setTab, tabs }: { tab: TabId; setTab: (tab: TabId) => void; tabs: readonly TabDef[] }) {
  const t = useT()
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)

  const current = tabs.find((item) => item.id === tab)
  const currentLabel = current ? t(current.labelKey) : t('edit.category')

  const panelStyle = useFloatingPanel({
    open,
    anchorRef: rootRef,
    panelRef,
    maxHeight: 280,
    widthMode: 'content',
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    setPortalRoot(resolvePortalRoot(rootRef.current))
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        className={cn(
          formControlChrome,
          FORM_CONTROL_H,
          'inline-flex cursor-pointer items-center justify-center px-2 text-ink',
          'hover:enabled:border-[rgb(230_238_248/0.2)]',
          'focus-visible:border-accent',
          open && 'border-accent'
        )}
        aria-label={`${t('edit.categoryMenu')}: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-active-tab={tab}
        onClick={() => setOpen((v) => !v)}
      >
        <GiHamburgerMenu size={16} aria-hidden />
      </button>

      {mounted && open && portalRoot
        ? createPortal(
            <div
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label={t('edit.categoryMenu')}
              className={cn('z-[70] min-w-[9.5rem] overflow-hidden rounded-[0.2rem] border border-line bg-[var(--panel-2)] p-0.5', 'shadow-[0_12px_32px_rgb(0_0_0/0.35)]')}
              style={panelStyle}
            >
              {tabs.map((item) => {
                const Icon = TAB_ICONS[item.id]
                const active = item.id === tab
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-[0.12rem] border-0 bg-transparent px-2 py-2 text-left text-[0.8125rem]',
                      'text-ink hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]',
                      active && 'text-accent'
                    )}
                    onClick={() => {
                      setTab(item.id)
                      close()
                    }}
                  >
                    <span className="inline-flex size-[1.05rem] shrink-0 items-center justify-center [&_svg]:size-full" aria-hidden>
                      <Icon />
                    </span>
                    <span className="min-w-0 flex-1 whitespace-nowrap">{t(item.labelKey)}</span>
                    {active ? <IoCheckmark size={14} className="shrink-0 text-accent" aria-hidden /> : <span className="inline-block w-3.5 shrink-0" aria-hidden />}
                  </button>
                )
              })}
            </div>,
            portalRoot
          )
        : null}
    </div>
  )
}

export function GameEditTabNav({ tab, setTab, surface }: Props) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [density, setDensity] = useState<Density>('label')

  const tabs = useMemo(() => tabsForSurface(surface), [surface])

  useEffect(() => {
    const el = rootRef.current?.parentElement
    if (!el) return
    const sync = () => setDensity(densityFromWidth(el.getBoundingClientRect().width))
    sync()
    const ro = new ResizeObserver(() => sync())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const navItems = useMemo(() => {
    if (density === 'label') {
      return tabs.map((item) => ({ id: item.id, label: t(item.labelKey) }))
    }
    return tabs.map((item) => {
      const Icon = TAB_ICONS[item.id]
      return { id: item.id, label: t(item.labelKey), icon: <Icon aria-hidden /> }
    })
  }, [density, tabs, t])

  return (
    <div ref={rootRef} className="min-w-0 shrink overflow-hidden" data-edit-categories="">
      {density === 'menu' ? (
        <TabIconMenu tab={tab} setTab={setTab} tabs={tabs} />
      ) : (
        <SegmentedNav items={navItems} value={tab} onChange={setTab} aria-label={t('edit.categoryMenu')} />
      )}
    </div>
  )
}
