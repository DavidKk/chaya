'use client'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { LEGAL_DOCS, type LegalDocId } from '@/lib/legal'
import { cn } from '@/lib/utils'

/** 条款正文：独立页面与局内「关于」共用 */
export function LegalDocBody({ id, className }: { id: LegalDocId; className?: string }) {
  const t = useT()
  const entry = LEGAL_DOCS[id]
  const doc = entry.content[useLocaleCode()]
  return (
    <article className={cn('flex w-full flex-col gap-6', className)} data-legal-doc={id}>
      <header className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-2xl font-semibold text-ink">{t(entry.titleKey)}</h1>
        <p className="m-0 text-xs text-ink-soft">{t('legal.updated', { date: entry.updated })}</p>
      </header>
      <div className="flex flex-col gap-3 rounded-[0.35rem] border border-line bg-panel p-4 text-sm leading-relaxed text-ink">
        {doc.intro.map((line) => (
          <p key={line} className="m-0">
            {line}
          </p>
        ))}
      </div>
      {doc.sections.map((section, index) => (
        <section key={section.id} aria-labelledby={`${id}-${section.id}`} className="flex flex-col gap-2">
          <h2 id={`${id}-${section.id}`} className="m-0 text-[0.9375rem] font-semibold text-ink">
            {`${index + 1}. ${section.title}`}
          </h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft marker:text-line">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {section.verbatim ? (
            <pre lang="en" className="m-0 overflow-x-auto rounded-[0.35rem] border border-line bg-panel p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink">
              {section.verbatim}
            </pre>
          ) : null}
        </section>
      ))}
    </article>
  )
}
