'use client'

import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

import type { TabId } from './tabs'

type Props = {
  tab: TabId
  lastEditTab: TabId
  setTab: (tab: TabId) => void
  refreshButton: ReactNode
  closeButton: ReactNode
}

export function GameEditMainNav({ tab, lastEditTab, setTab, refreshButton, closeButton }: Props) {
  const t = useT()
  const showEditNav = tab !== 'trans' && tab !== 'logs'
  return (
    <nav aria-label={t('edit.mainNav')} className="flex h-[3.25rem] shrink-0 items-stretch border-b border-line bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] px-4">
      {(
        [
          { id: 'edit', labelKey: 'edit.tabEdit' as const, target: lastEditTab },
          { id: 'trans', labelKey: 'edit.tabTranslate' as const, target: 'trans' as const },
          { id: 'logs', labelKey: 'edit.tabLogs' as const, target: 'logs' as const },
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
              'relative inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent px-[0.8rem] text-[0.9375rem] font-semibold text-ink-soft transition-colors hover:text-ink',
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
      <div className="ml-auto flex items-center gap-[0.4rem]">
        {refreshButton}
        {closeButton}
      </div>
    </nav>
  )
}
