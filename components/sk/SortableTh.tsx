'use client'

import { IoCaretDown, IoCaretUp } from 'react-icons/io5'

import type { ThreeStateSortDir } from '@/lib/ui/three-state-sort'
import { cn } from '@/lib/utils'

export type SortableThProps = {
  label: string
  /** 当前是否按本列显式排序 */
  active: boolean
  order: ThreeStateSortDir
  disabled?: boolean
  onCycle: () => void
  className?: string
}

/** 可点表头：未激活 → 升序 → 降序 → 还原（由 onCycle 实现） */
export function SortableTh({ label, active, order, disabled, onCycle, className }: SortableThProps) {
  const tip = !active ? '按升序排列' : order === 'asc' ? '按降序排列' : '还原默认排序'
  return (
    <th className={className} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={cn(
          'm-0 inline-flex cursor-pointer items-center gap-0.5 border-none bg-transparent p-0 text-inherit outline-none',
          'hover:enabled:text-ink focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed',
          active ? 'text-ink' : 'text-ink-soft'
        )}
        disabled={disabled}
        title={tip}
        aria-label={`${label}：${tip}`}
        onClick={onCycle}
      >
        <span>{label}</span>
        <span className="inline-flex w-3 flex-col items-center leading-none" aria-hidden>
          <IoCaretUp size={8} className={cn('-mb-0.5', active && order === 'asc' ? 'opacity-100' : 'opacity-35')} />
          <IoCaretDown size={8} className={cn('-mt-0.5', active && order === 'desc' ? 'opacity-100' : 'opacity-35')} />
        </span>
      </button>
    </th>
  )
}
