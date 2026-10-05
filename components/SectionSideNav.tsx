'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function sectionSideNavItemClass(active: boolean) {
  return cn(
    'grid size-8 place-items-center rounded-[0.35rem] border p-0 no-underline',
    'transition-[background,border-color,color] duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]',
    active
      ? 'border-[color-mix(in_oklab,var(--accent)_38%,transparent)] bg-[color-mix(in_oklab,var(--accent)_13%,transparent)] text-ink'
      : 'border-transparent text-ink-soft hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-ink'
  )
}

export function SectionSideNav({ label, children, mobile = false }: { label: string; children: ReactNode; mobile?: boolean }) {
  return (
    <aside
      className={cn(
        'h-full min-h-0 w-11 shrink-0 border-r border-line bg-paper',
        mobile
          ? 'h-auto w-full overflow-x-auto border-r-0 border-b md:h-full md:w-11 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0'
          : 'hidden overflow-y-auto md:block'
      )}
      data-section-side-nav
      data-mobile-visible={mobile || undefined}
    >
      <nav className="p-2" aria-label={label}>
        <ul className={cn('m-0 flex list-none gap-1 p-0', mobile ? 'min-w-max md:min-w-0 md:flex-col' : 'flex-col')}>{children}</ul>
      </nav>
    </aside>
  )
}

export function SectionSideNavItemContent({ active, icon }: { active: boolean; icon: ReactNode }) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-[0.3rem] bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]',
        active && 'bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] text-accent'
      )}
      aria-hidden
    >
      {icon}
    </span>
  )
}
