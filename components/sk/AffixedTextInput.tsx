'use client'

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

import { controlDisabled, controlDisabledShell, FORM_CONTROL_H, formControlChrome } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export type AffixedTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & {
  invalid?: boolean
  /** Left segment inside the same chrome (e.g. embedded Select). */
  prefix?: ReactNode
  /** Right segment inside the same chrome (icon / action). */
  endAction?: ReactNode
  /** Tip for the text field only when affixes are present. */
  tooltip?: string
}

/**
 * Single form control chrome with optional prefix + text + end action.
 * Matches NumberInput: do not split chrome / addon into sibling fragments.
 */
export const AffixedTextInput = forwardRef<HTMLInputElement, AffixedTextInputProps>(function AffixedTextInput(
  { className, invalid = false, disabled, prefix, endAction, tooltip, ...rest },
  ref
) {
  const affix = prefix != null || endAction != null
  const input = (
    <input
      ref={ref}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={cn(
        affix
          ? 'm-0 h-full min-h-0 min-w-0 flex-1 appearance-none rounded-none border-none bg-transparent px-1.5 py-0 font-inherit text-[0.8125rem] leading-none text-ink outline-none disabled:cursor-not-allowed'
          : cn(formControlChrome, FORM_CONTROL_H, 'px-2 focus:border-accent', controlDisabled),
        !affix && className
      )}
      {...rest}
      onKeyDown={(e) => {
        e.stopPropagation()
        rest.onKeyDown?.(e)
      }}
      onKeyUp={(e) => {
        e.stopPropagation()
        rest.onKeyUp?.(e)
      }}
    />
  )

  if (!affix) return input

  const tipped =
    tooltip != null && tooltip !== '' ? (
      <Tooltip content={tooltip} triggerClassName="inline-flex h-full min-w-0 flex-1">
        {input}
      </Tooltip>
    ) : (
      input
    )

  return (
    <span
      className={cn(
        formControlChrome,
        FORM_CONTROL_H,
        'inline-flex w-full min-w-0 items-center gap-1 pr-1.5 focus-within:border-accent',
        prefix == null && 'pl-1.5',
        invalid && 'border-fail',
        disabled && controlDisabledShell,
        className
      )}
      data-disabled={disabled || undefined}
    >
      {prefix != null ? <span className="inline-flex h-full shrink-0 items-center self-stretch border-r border-line">{prefix}</span> : null}
      {tipped}
      {endAction != null ? <span className="inline-flex shrink-0 items-center">{endAction}</span> : null}
    </span>
  )
})
