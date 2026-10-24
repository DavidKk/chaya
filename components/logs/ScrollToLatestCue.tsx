'use client'

import { ChevronsDown } from 'lucide-react'

import { cn } from '@/lib/utils'

type Props = {
  ariaLabel: string
  onActivate: () => void
  /** Required position — e.g. `bottom-0` (log) or `bottom-6` (companion above composer). */
  className?: string
}

/**
 * Full-width accent ribbon + chevrons (same cue as companion diary).
 * Callers must set vertical position via className (no default bottom offset).
 */
export function ScrollToLatestCue({ ariaLabel, onActivate, className }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'absolute inset-x-0 z-[5] h-4 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent',
        className
      )}
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate()
        }
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-1/2 h-8 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--accent)_48%,transparent),transparent)] opacity-80 blur-sm"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color-mix(in_oklab,var(--accent)_82%,transparent)] shadow-[0_-3px_12px_2px_var(--accent-glow)]"
      />
      <ChevronsDown
        size={18}
        strokeWidth={2.5}
        className="absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 text-accent drop-shadow-[0_0_6px_var(--accent-glow)] motion-safe:animate-pulse motion-reduce:animate-none"
        aria-hidden
      />
    </div>
  )
}
