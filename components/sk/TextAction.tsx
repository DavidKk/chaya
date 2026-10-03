'use client'

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'

import { Spinner } from '@/components/sk/Spinner'
import { cn } from '@/lib/utils'

export type TextActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  children?: ReactNode
}

export const TextAction = forwardRef<HTMLButtonElement, TextActionProps>(function TextAction({ loading = false, disabled, className, type = 'button', children, ...rest }, ref) {
  const isDisabled = disabled || loading
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'm-0 inline-flex appearance-none items-center gap-1 border-none bg-transparent p-[0.2rem_0.15rem] font-inherit text-[0.8125rem] font-medium leading-none text-ink-soft',
        'cursor-pointer hover:enabled:text-ink',
        'disabled:cursor-wait disabled:opacity-50',
        'focus-visible:rounded-[0.15rem] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  )
})
