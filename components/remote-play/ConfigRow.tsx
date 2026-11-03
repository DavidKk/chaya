'use client'

import React from 'react'
import { LuChevronRight } from 'react-icons/lu'

export type ConfigRowProps = {
  icon?: React.ReactNode
  label: React.ReactNode
  description?: React.ReactNode
  control?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  className?: string
}

/** Consistent spacing and controls across remote play settings. */
export function ConfigRow({ icon, label, description, control, onClick, disabled = false, danger = false, className = '' }: ConfigRowProps) {
  const isClickable = Boolean(onClick) && !disabled

  const row = (
    <div
      className={`group flex w-full items-center justify-between gap-2 rounded-[0.2rem] border px-3 py-2 text-xs transition-colors select-none ${
        danger ? 'border-fail/25 bg-fail/10 text-fail hover:bg-fail/15 hover:border-fail/35' : 'border-line bg-panel-2 text-ink hover:bg-inset hover:border-accent/40'
      } ${isClickable ? 'cursor-pointer active:scale-[0.99]' : ''} ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    >
      {/* Left: Standard Icon (5x5) + Label + Optional Subtitle */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
        {icon && <div className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">{icon}</div>}
        <div className="flex flex-col min-w-0">
          <span className="font-medium whitespace-nowrap truncate text-xs leading-tight">{label}</span>
          {description && <span className="text-[10px] text-ink-soft whitespace-nowrap truncate leading-tight mt-0.5">{description}</span>}
        </div>
      </div>

      {/* Right: Control element or value badge + chevron */}
      <div className="flex items-center gap-1.5 shrink-0">
        {control}
        {isClickable && !control && <LuChevronRight size={14} className="text-ink-soft group-hover:text-ink transition-colors shrink-0" />}
      </div>
    </div>
  )

  if (isClickable) {
    return (
      <button type="button" disabled={disabled} onClick={onClick} className="w-full text-left">
        {row}
      </button>
    )
  }

  return row
}
