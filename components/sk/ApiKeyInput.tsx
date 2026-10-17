'use client'

import type { InputHTMLAttributes } from 'react'

import { TextInput } from '@/components/sk/TextInput'
import { cn } from '@/lib/utils'

/** Fixed mask for a saved secret — length must not leak the real value. */
export const API_KEY_SEALED_MASK = '••••••••'

export type ApiKeySaveAction = { kind: 'keep' } | { kind: 'set'; token: string } | { kind: 'clear' }

/**
 * Decide what to persist after the form save.
 * - Non-empty draft always sets (first entry may keep `unlocked=false`)
 * - Unlocked + empty clears the saved secret
 * - Sealed (not unlocked, empty draft) keeps the existing secret
 */
export function resolveApiKeySaveAction(input: { unlocked: boolean; value: string }): ApiKeySaveAction {
  const token = input.value.trim()
  if (token) return { kind: 'set', token }
  if (input.unlocked) return { kind: 'clear' }
  return { kind: 'keep' }
}

export type ApiKeyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'readOnly' | 'size'> & {
  /** Server already has a saved key. */
  configured: boolean
  /** Draft while unlocked; ignored when sealed. */
  value: string
  onChange: (value: string) => void
  /** false + configured → show mask; true → plaintext edit. */
  unlocked: boolean
  onUnlockedChange: (unlocked: boolean) => void
  invalid?: boolean
  fullWidth?: boolean
}

/**
 * Write-only API key field: sealed mask when saved; click clears and edits in plaintext;
 * after save the parent sets `configured` and `unlocked=false` to reseal.
 */
export function ApiKeyInput({ configured, value, onChange, unlocked, onUnlockedChange, className, placeholder, disabled, invalid, fullWidth = true, ...rest }: ApiKeyInputProps) {
  const sealed = configured && !unlocked
  return (
    <TextInput
      {...rest}
      type="text"
      fullWidth={fullWidth}
      className={cn(className)}
      invalid={invalid}
      disabled={disabled}
      value={sealed ? API_KEY_SEALED_MASK : value}
      placeholder={sealed ? undefined : placeholder}
      readOnly={sealed || disabled}
      autoComplete="off"
      spellCheck={false}
      onFocus={(event) => {
        rest.onFocus?.(event)
        if (sealed && !disabled) {
          onUnlockedChange(true)
          onChange('')
        }
      }}
      onChange={(event) => {
        if (sealed || disabled) return
        onChange(event.target.value)
      }}
    />
  )
}
