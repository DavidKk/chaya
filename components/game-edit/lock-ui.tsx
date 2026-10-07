'use client'

import { IoLockClosed, IoLockOpenOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { controlDisabled } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export const lockIconBtn = cn(
  'm-0 inline-flex h-[1.35rem] w-[1.35rem] cursor-pointer items-center justify-center rounded-[0.15rem] border-none bg-transparent p-0 text-ink-soft',
  'hover:enabled:bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] hover:enabled:text-ink',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]',
  controlDisabled
)

export function LockEndAction({ locked, name, onChange }: { locked: boolean; name: string; onChange: (on: boolean) => void }) {
  const t = useT()
  const tip = locked ? t('edit.lockOff', { name }) : t('edit.lockOn', { name })
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        className={cn(lockIconBtn, locked && 'text-accent hover:enabled:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:enabled:text-accent')}
        aria-label={tip}
        aria-pressed={locked}
        onClick={() => onChange(!locked)}
      >
        {locked ? <IoLockClosed size={15} aria-hidden /> : <IoLockOpenOutline size={15} aria-hidden />}
      </button>
    </Tooltip>
  )
}
