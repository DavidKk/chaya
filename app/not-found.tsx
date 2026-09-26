'use client'

import Link from 'next/link'

import { useT } from '@/components/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

/** 全局 404：跟 Chaya 深色主题与 accent，避免 Next 默认白底页 */
export default function NotFound() {
  const t = useT()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16" role="status" aria-live="polite">
      <div className="max-w-sm text-center">
        <p
          className={cn(
            'm-0 font-display text-[3.25rem] font-semibold leading-none tracking-[-0.03em] text-accent',
            'drop-shadow-[0_0_24px_color-mix(in_oklab,var(--accent-glow)_55%,transparent)]'
          )}
        >
          404
        </p>
        <p className="mt-4 mb-0 text-[0.9375rem] font-medium text-ink">{t('notFound.title')}</p>
        <p className="mt-[0.4rem] mb-0 text-[0.75rem] leading-relaxed text-ink-soft">{t('notFound.hint')}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/game"
            className={cn(
              'inline-flex h-8 min-w-[7.5rem] items-center justify-center rounded-[0.2rem] px-[0.85rem]',
              'border-0 bg-accent text-[0.8125rem] font-semibold text-accent-ink no-underline',
              'shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_40%,transparent),0_3px_14px_color-mix(in_oklab,var(--accent-glow)_45%,transparent)]',
              'transition-[filter,box-shadow] duration-100 hover:brightness-110'
            )}
          >
            {t('notFound.backLibrary')}
          </Link>
          <Link
            href="/translate/run"
            className={cn(
              'inline-flex h-8 items-center justify-center rounded-[0.2rem] border border-line bg-transparent px-[0.85rem]',
              'text-[0.8125rem] font-medium text-ink-soft no-underline transition-colors hover:bg-[rgb(230_238_248/0.06)] hover:text-ink'
            )}
          >
            {t('notFound.translate')}
          </Link>
        </div>
      </div>
    </div>
  )
}
