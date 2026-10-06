'use client'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { DISCLAIMER } from '@/lib/legal/disclaimer'
import { cn } from '@/lib/utils'

/** 免责声明正文；`nested` 时章节标题降为 h3（嵌在其它页面的 h2 下） */
export function DisclaimerContent({ nested = false, className }: { nested?: boolean; className?: string }) {
  const doc = DISCLAIMER[useLocaleCode()]
  const Heading = nested ? 'h3' : 'h2'
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-3 rounded-[0.35rem] border border-line bg-panel p-4 text-sm leading-relaxed text-ink">
        {doc.intro.map((line) => (
          <p key={line} className="m-0">
            {line}
          </p>
        ))}
      </div>
      {doc.sections.map((section, index) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="flex scroll-mt-4 flex-col gap-2">
          <Heading id={`${section.id}-title`} className="m-0 text-[0.9375rem] font-semibold text-ink">
            {`${index + 1}. ${section.title}`}
          </Heading>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft marker:text-line">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
