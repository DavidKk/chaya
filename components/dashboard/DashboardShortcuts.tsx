'use client'

import Link from 'next/link'
import type { IconType } from 'react-icons'
import { IoCreateOutline, IoDocumentTextOutline, IoLanguageOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const HOME_SHORTCUTS: { href: string; titleKey: MessageKey; descKey: MessageKey; Icon: IconType }[] = [
  { href: '/cheat/run', titleKey: 'nav.edit', descKey: 'dashboard.shortcutEditDesc', Icon: IoCreateOutline },
  { href: '/translate/run', titleKey: 'nav.translate', descKey: 'dashboard.shortcutTranslateDesc', Icon: IoLanguageOutline },
  { href: '/logs', titleKey: 'nav.logs', descKey: 'dashboard.shortcutLogsDesc', Icon: IoDocumentTextOutline },
]

export function DashboardShortcuts() {
  const t = useT()
  return (
    <nav className="grid grid-cols-3 gap-3 border-t border-[var(--line-soft)] pt-4" aria-label={t('dashboard.shortcutNav')}>
      {HOME_SHORTCUTS.map(({ href, titleKey, descKey, Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'group flex min-w-0 items-center gap-3 rounded-[0.4rem] border border-line bg-inset px-3.5 py-3 no-underline',
            'transition-colors hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] hover:bg-[color-mix(in_oklab,var(--accent)_8%,var(--inset))]',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'
          )}
        >
          <span
            className={cn(
              'inline-flex size-10 shrink-0 items-center justify-center rounded-[0.35rem] border border-line bg-panel text-accent',
              'transition-colors group-hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] group-hover:bg-[color-mix(in_oklab,var(--accent)_10%,var(--panel))]'
            )}
            aria-hidden
          >
            <Icon size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[0.875rem] font-medium leading-[1.3] text-ink">{t(titleKey)}</span>
            <span className="truncate text-[0.72rem] leading-[1.4] text-ink-soft">{t(descKey)}</span>
          </span>
        </Link>
      ))}
    </nav>
  )
}
