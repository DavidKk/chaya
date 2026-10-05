'use client'

import type { ReactNode } from 'react'
import { IoSparklesOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { Button } from '@/components/sk'
import { cn } from '@/lib/utils'

import { isEditTab, type TabId } from './tabs'

type Props = {
  tab: TabId
  lastEditTab: TabId
  setTab: (tab: TabId) => void
  closeButton: ReactNode
}

export function GameEditMainNav({ tab, lastEditTab, setTab, closeButton }: Props) {
  const t = useT()
  const showEditNav = isEditTab(tab)
  return (
    <nav aria-label={t('edit.mainNav')} className="flex h-[3.25rem] shrink-0 items-stretch border-b border-line bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] px-4">
      {(
        [
          { id: 'edit', labelKey: 'edit.tabEdit' as const, target: lastEditTab },
          { id: 'trans', labelKey: 'edit.tabTranslate' as const, target: 'trans' as const },
          { id: 'logs', labelKey: 'edit.tabLogs' as const, target: 'logs' as const },
          { id: 'mcp', labelKey: 'nav.integration' as const, target: 'mcp' as const },
          { id: 'settings', labelKey: 'nav.settings' as const, target: 'settings' as const },
        ] as const
      ).map((item) => {
        const active = item.id === (showEditNav ? 'edit' : tab)
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
            onClick={() => setTab(item.target)}
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
          <IoSparklesOutline size={17} aria-hidden />
        </Button>
        {closeButton}
      </div>
    </nav>
  )
}
