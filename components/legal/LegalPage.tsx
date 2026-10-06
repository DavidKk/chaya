'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { BrandLogo } from '@/components/BrandLogo'
import { useT } from '@/components/i18n/LocaleProvider'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { LEGAL_DOC_IDS, LEGAL_DOCS, type LegalDocId } from '@/lib/legal'
import { cn } from '@/lib/utils'

import { CreditsList } from './CreditsList'
import { LegalDocBody } from './LegalDocBody'

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'

/** `/disclaimer`、`/privacy`、`/license`：三种形态都可打开，不挂控制台顶栏 */
export function LegalPage({ id }: { id: LegalDocId }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-[1] flex flex-col bg-transparent text-ink">
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 pt-4 sm:px-10 sm:pt-6">
        <BrandLogo href="/" className="text-lg" markClassName="size-7" priority />
        <div className="flex items-center gap-3">
          <LocaleSwitcher compact />
          <Link href="/" className={`inline-flex items-center gap-1 text-sm text-ink-soft no-underline transition-colors hover:text-ink ${focusRing}`}>
            <ArrowLeft aria-hidden className="size-3.5" />
            {t('legal.back')}
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8 sm:px-10 sm:py-10">
        <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6">
          <nav aria-label={t('legal.docs')}>
            <ul className="m-0 flex list-none flex-wrap gap-1 border-b border-line p-0">
              {LEGAL_DOC_IDS.map((docId) => {
                const active = docId === id
                return (
                  <li key={docId}>
                    <Link
                      href={LEGAL_DOCS[docId].href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative inline-flex px-3 py-2 text-sm font-medium no-underline transition-colors',
                        focusRing,
                        active ? 'text-ink after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-accent' : 'text-ink-soft hover:text-ink'
                      )}
                    >
                      {t(LEGAL_DOCS[docId].titleKey)}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <LegalDocBody id={id} />
          {id === 'license' ? (
            <section aria-labelledby="license-credits" className="flex flex-col gap-4 border-t border-line pt-6">
              <h2 id="license-credits" className="m-0 font-display text-xl font-semibold text-ink">
                {t('credits.title')}
              </h2>
              <CreditsList level={3} />
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}
