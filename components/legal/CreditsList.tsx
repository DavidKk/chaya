'use client'

import { LuExternalLink } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { GITHUB_CONTRIBUTORS_URL, openExternal } from '@/lib/about'
import { CREDIT_GROUPS } from '@/lib/credits'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const GROUP_LABEL = {
  platform: 'credits.groupPlatform',
  ui: 'credits.groupUi',
  text: 'credits.groupText',
  ai: 'credits.groupAi',
  build: 'credits.groupBuild',
  assets: 'credits.groupAssets',
} as const satisfies Record<(typeof CREDIT_GROUPS)[number]['id'], MessageKey>

const THANKS_KEYS = [
  'credits.thanksContributors',
  'credits.thanksMaintainers',
  'credits.thanksCreators',
  'credits.thanksCommunity',
  'credits.thanksPlayers',
] as const satisfies readonly MessageKey[]

const linkClass =
  'group inline-flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-sm font-medium text-ink transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'

/** 主要开源工具（附许可证与署名）+ 感谢名单 */
export function CreditsList({ className, level = 2 }: { className?: string; level?: 2 | 3 }) {
  const t = useT()
  const Title = level === 2 ? 'h2' : 'h3'
  const Group = level === 2 ? 'h3' : 'h4'
  return (
    <div className={cn('flex w-full flex-col gap-6', className)} data-credits>
      <section aria-labelledby="credits-tools" className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <Title id="credits-tools" className="m-0 text-[0.9375rem] font-semibold text-ink">
            {t('credits.toolsTitle')}
          </Title>
          <p className="m-0 text-xs leading-relaxed text-ink-soft">{t('credits.toolsDesc')}</p>
        </header>
        {CREDIT_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <Group className="m-0 text-xs font-semibold tracking-wide text-ink-soft uppercase">{t(GROUP_LABEL[group.id])}</Group>
            <ul className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-1.5 p-0 sm:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.name} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line pb-1.5">
                  <span className="flex min-w-0 flex-col">
                    <button type="button" data-credit={item.name} className={linkClass} onClick={() => openExternal(item.url)}>
                      <span className="truncate">{item.name}</span>
                      <LuExternalLink size={11} aria-hidden className="shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                    </button>
                    {item.author ? <span className="truncate text-[0.6875rem] text-ink-soft">{item.author}</span> : null}
                  </span>
                  <span className="shrink-0 font-mono text-[0.6875rem] text-ink-soft">{item.license}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="credits-thanks" className="flex flex-col gap-2">
        <Title id="credits-thanks" className="m-0 text-[0.9375rem] font-semibold text-ink">
          {t('credits.thanksTitle')}
        </Title>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft marker:text-line">
          {THANKS_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <button type="button" data-credit="contributors" className={cn(linkClass, 'self-start text-accent hover:text-ink')} onClick={() => openExternal(GITHUB_CONTRIBUTORS_URL)}>
          {t('credits.contributorsLink')}
          <LuExternalLink size={12} aria-hidden className="shrink-0" />
        </button>
      </section>
    </div>
  )
}
