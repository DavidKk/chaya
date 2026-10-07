'use client'

import { Info } from 'lucide-react'
import Link from 'next/link'

import { useT } from '@/components/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

export type LegalNoticeKind = 'translate' | 'edit' | 'agent' | 'integration' | 'library'

export const DISCLAIMER_HREF = '/disclaimer'

/** 各功能入口的一行使用须知；局内浮层（NW.js 游戏窗口）不放链接，避免把游戏页跳走 */
export function LegalNotice({ kind, link = true, className }: { kind: LegalNoticeKind; link?: boolean; className?: string }) {
  const t = useT()
  return (
    <p role="note" aria-label={t('legal.noticeAria')} className={cn('m-0 flex items-start gap-1.5 text-xs leading-relaxed text-ink-soft', className)}>
      <span aria-hidden className="flex h-[1.625em] shrink-0 items-center">
        <Info size={13} />
      </span>
      <span className="min-w-0">
        {t(`legal.${kind}`)}
        {link ? (
          <>
            {' '}
            <Link href={DISCLAIMER_HREF} className="text-ink-soft underline decoration-line underline-offset-2 transition-colors hover:text-ink">
              {t('legal.link')}
            </Link>
          </>
        ) : null}
      </span>
    </p>
  )
}
