'use client'

import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'

import { BrandMarkInline } from '@/components/BrandMarkInline'
import { useT } from '@/components/i18n/LocaleProvider'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { mainNavFor } from '@/components/main-nav'
import { Button } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { PRODUCT_DISPLAY_NAME } from '@/constants/brand'
import { cn } from '@/lib/utils'

import { panelDragHandlers } from './panel-drag'
import { mainNavIdForTab, overlayTabFor, type TabId } from './tabs'

type Props = {
  tab: TabId
  lastEditTab: TabId
  setTab: (tab: TabId) => void
  closeButton: ReactNode
}

export function GameEditMainNav({ tab, lastEditTab, setTab, closeButton }: Props) {
  const t = useT()
  const currentId = mainNavIdForTab(tab)
  const drag = panelDragHandlers()
  return (
    <nav
      aria-label={t('edit.mainNav')}
      {...drag}
      className="flex h-[3.25rem] shrink-0 cursor-move touch-none items-stretch border-b border-line bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] px-4 select-none"
    >
      <Tooltip content={PRODUCT_DISPLAY_NAME}>
        <span role="img" aria-label={PRODUCT_DISPLAY_NAME} className="mr-2 inline-flex shrink-0 items-center self-center">
          <BrandMarkInline className="size-7" animated />
        </span>
      </Tooltip>
      {mainNavFor('overlay').map((item) => {
        const target = overlayTabFor(item.id, lastEditTab)
        if (!target) return null
        const active = item.id === currentId
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            data-main-nav-id={item.id}
            className={cn(
              'relative inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent px-3 text-[0.9375rem] font-semibold text-ink-soft transition-colors hover:text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
              active && 'text-ink'
            )}
            onClick={() => setTab(target)}
          >
            {t(item.labelKey)}
            {active ? <span aria-hidden className="absolute right-0 bottom-[-1px] left-0 h-0.5 bg-accent" /> : null}
          </button>
        )
      })}
      <div className="ml-auto flex items-center gap-2">
        <LocaleSwitcher compact />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Chaya 助手"
          tooltip="Chaya 助手 (Ctrl/⌘ + Shift + A)"
          onClick={() => window.dispatchEvent(new CustomEvent('chaya:game-agent-toggle'))}
        >
          <Bot size={15} aria-hidden />
        </Button>
        {closeButton}
      </div>
    </nav>
  )
}
