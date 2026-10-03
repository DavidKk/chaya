import Image from 'next/image'
import Link from 'next/link'

import { PRODUCT_DISPLAY_NAME } from '@/constants/brand'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  markClassName?: string
  wordmarkClassName?: string
  priority?: boolean
  href?: string
  animated?: boolean
}

/** Chaya mark only; `animated` blinks the eyes. */
export function BrandMark({ className, priority = false, animated = false }: { className?: string; priority?: boolean; animated?: boolean }) {
  return animated ? (
    <svg viewBox="205 195 650 650" aria-hidden focusable="false" className={cn('size-6 shrink-0', className)}>
      <use href="/brand/chaya-mark.svg#chaya-body" />
      <use
        href="/brand/chaya-mark.svg#chaya-eyes"
        data-chaya-eyes
        className="origin-center animate-[chaya-blink_6s_ease-in-out_infinite] [transform-box:fill-box] motion-reduce:animate-none"
      />
    </svg>
  ) : (
    <Image src="/brand/chaya-mark.svg" alt="" aria-hidden width={40} height={40} priority={priority} className={cn('size-6 shrink-0', className)} />
  )
}

/** Shared Chaya mark and wordmark for dark application surfaces. */
export function BrandLogo({ className, markClassName, wordmarkClassName, priority = false, href, animated = false }: Props) {
  const mark = <BrandMark className={markClassName} priority={priority} animated={animated} />

  const content = (
    <>
      {mark}
      <span className={cn('font-display font-semibold leading-none text-ink', wordmarkClassName)}>{PRODUCT_DISPLAY_NAME}</span>
    </>
  )

  const logoClassName = cn('inline-flex min-w-0 items-center gap-2', className)

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`${PRODUCT_DISPLAY_NAME} 首页`}
        className={cn(
          logoClassName,
          'rounded-[0.25rem] no-underline transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'
        )}
      >
        {content}
      </Link>
    )
  }

  return <span className={logoClassName}>{content}</span>
}
