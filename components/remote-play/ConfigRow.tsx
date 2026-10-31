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

/**
 * Reusable Unified Configuration Item Row (Requirement 5)
 * Guarantees identical padding, icon frame, label spacing, font sizing, and container rhythm across all setting tabs.
 */
export function ConfigRow({
  icon,
  label,
  description,
  control,
  onClick,
  disabled = false,
  danger = false,
  className = '',
}: ConfigRowProps) {
  const isClickable = Boolean(onClick) && !disabled

  const row = (
    <div
      className={`group flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition-colors select-none ${
        danger
          ? 'border-rose-500/25 bg-rose-950/20 text-rose-300 hover:bg-rose-900/30 hover:border-rose-500/35'
          : 'border-white/5 bg-white/[0.03] text-neutral-200 hover:bg-white/[0.06] hover:border-white/10'
      } ${isClickable ? 'cursor-pointer active:scale-[0.99]' : ''} ${
        disabled ? 'opacity-40 cursor-not-allowed' : ''
      } ${className}`}
      onClick={isClickable && control ? onClick : undefined}
    >
      {/* Left: Standard Icon (5x5) + Label + Optional Subtitle */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
        {icon && (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">
            {icon}
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="font-medium text-neutral-200 whitespace-nowrap truncate text-xs leading-tight">
            {label}
          </span>
          {description && (
            <span className="text-[10px] text-neutral-400 whitespace-nowrap truncate leading-tight mt-0.5">
              {description}
            </span>
          )}
        </div>
      </div>

      {/* Right: Control element or value badge + chevron */}
      <div className="flex items-center gap-1.5 shrink-0">
        {control}
        {isClickable && !control && (
          <LuChevronRight
            size={14}
            className="text-neutral-500 group-hover:text-neutral-300 transition-colors shrink-0"
          />
        )}
      </div>
    </div>
  )

  if (isClickable && !control) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="w-full text-left"
      >
        {row}
      </button>
    )
  }

  return row
}
