'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'
import { IoSearchOutline } from 'react-icons/io5'

import { controlDisabled, controlDisabledShell, FORM_CONTROL_H, formControlChrome, formControlPadX } from '@/components/sk/control'
import { cn } from '@/lib/utils'

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  invalid?: boolean
  /** 在 flex 行内占满剩余宽度（不影响默认自适应宽度） */
  fullWidth?: boolean
  /** 搜索框：左侧内嵌 search 图标（与输入同框，勿外挂独立搜索钮） */
  search?: boolean
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, invalid = false, fullWidth = false, search = false, type = 'text', disabled, ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      type={type}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={cn(
        search
          ? cn(
              'm-0 h-full min-h-0 min-w-0 flex-1 appearance-none rounded-none border-none bg-transparent py-0 pr-0.5 pl-0',
              'font-inherit text-[0.8125rem] leading-none text-ink outline-none',
              'disabled:cursor-not-allowed'
            )
          : cn(formControlChrome, formControlPadX, FORM_CONTROL_H, 'min-w-[5.5rem] focus:border-accent', controlDisabled),
        !search && fullWidth && 'w-full min-w-0 flex-1',
        !search && invalid && 'border-fail',
        !search && className
      )}
      {...rest}
    />
  )

  if (!search) return input

  return (
    <span
      className={cn(
        formControlChrome,
        FORM_CONTROL_H,
        'inline-flex min-w-[5.5rem] items-center gap-1 pr-2 pl-2 focus-within:border-accent',
        fullWidth && 'w-full min-w-0 flex-1',
        invalid && 'border-fail',
        disabled && controlDisabledShell,
        className
      )}
      data-disabled={disabled || undefined}
    >
      <IoSearchOutline size={14} className="shrink-0 text-ink-soft" aria-hidden />
      {input}
    </span>
  )
})
