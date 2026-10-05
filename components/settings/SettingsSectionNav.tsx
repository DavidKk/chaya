'use client'

import Link from 'next/link'
import { RiRobot2Line } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

const navItemClass = cn(
  'flex min-h-11 min-w-0 items-center gap-2 rounded-[0.35rem] border px-3 py-2 text-left no-underline',
  'border-[color-mix(in_oklab,var(--accent)_38%,transparent)] bg-[color-mix(in_oklab,var(--accent)_13%,transparent)] text-ink',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'
)

function AgentNavItem() {
  const t = useT()
  return (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-[0.3rem] bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] text-accent" aria-hidden>
        <RiRobot2Line size={17} />
      </span>
      <span className="truncate text-[0.8125rem] font-semibold text-ink">{t('integration.agentSettingsTab')}</span>
    </>
  )
}

export function SettingsSectionNav({ href, onSelect }: { href?: string; onSelect?: () => void }) {
  const t = useT()
  return (
    <aside className="shrink-0 border-b border-line bg-paper md:w-44 md:border-r md:border-b-0" data-settings-section-nav>
      <nav className="p-2" aria-label={t('integration.agentSettingsSection')}>
        {href ? (
          <Link href={href} aria-current="page" className={navItemClass}>
            <AgentNavItem />
          </Link>
        ) : (
          <button type="button" aria-current="page" className={cn(navItemClass, 'w-full cursor-pointer')} onClick={onSelect}>
            <AgentNavItem />
          </button>
        )}
      </nav>
    </aside>
  )
}
