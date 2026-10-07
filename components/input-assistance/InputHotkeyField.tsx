'use client'

import { type KeyboardEvent, type MouseEvent, useRef, useState } from 'react'
import { IoCloseOutline } from 'react-icons/io5'

import { hotkeyClearBtn, hotkeyInput, hotkeyShell } from '@/components/game-edit'
import { Tooltip } from '@/components/sk'
import { atomLabel, type InputChord, type KeyInput } from '@/lib/game/input-assistance'
import { cn } from '@/lib/utils'

import { hasKeyIcon, KeyText } from './KeyText'

type Props = {
  label: string
  value: InputChord
  onChange: (value: InputChord) => void
  warning?: string
  compact?: boolean
  disabled?: boolean
}

const modifierKeys = [
  { active: 'ctrlKey', code: 'ControlLeft', key: 'Control', keyCode: 17 },
  { active: 'altKey', code: 'AltLeft', key: 'Alt', keyCode: 18 },
  { active: 'shiftKey', code: 'ShiftLeft', key: 'Shift', keyCode: 16 },
  { active: 'metaKey', code: 'MetaLeft', key: 'Meta', keyCode: 91 },
] as const

const modifierLabels: Record<string, string> = { Control: 'Ctrl', Meta: 'Cmd', Alt: 'Alt', Shift: 'Shift' }

function modifiers(event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): KeyInput[] {
  return modifierKeys.filter(({ active }) => event[active]).map(({ code, key, keyCode }) => ({ kind: 'key', code, key, keyCode, location: 1 }))
}

function displayChord(chord: InputChord): string {
  const parts = chord.map((atom) => (atom.kind === 'key' && modifierLabels[atom.key] ? modifierLabels[atom.key] : atomLabel(atom)))
  return [...new Set(parts)].join('+')
}

export function InputHotkeyField({ label, value, onChange, warning, compact = false, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [recording, setRecording] = useState(false)
  const summary = displayChord(value)
  const iconOverlay = !recording && hasKeyIcon(summary)

  function finish(next: InputChord) {
    onChange(next)
    setRecording(false)
    inputRef.current?.blur()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!recording || event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      finish([])
      return
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
    finish([...modifiers(event), { kind: 'key', code: event.code || event.key, key: event.key, keyCode: event.nativeEvent.keyCode, location: event.location }])
  }

  function onMouseDown(event: MouseEvent<HTMLInputElement>) {
    if (document.activeElement !== inputRef.current) return
    if (event.button > 2) return
    event.preventDefault()
    event.stopPropagation()
    finish([...modifiers(event), { kind: 'mouse', button: event.button as 0 | 1 | 2 }])
  }

  const field = (
    <span className={cn(hotkeyShell, recording && 'border-accent', warning && !recording && 'border-warn', disabled && 'opacity-60')} data-recording={recording || undefined}>
      <input
        ref={inputRef}
        type="text"
        readOnly
        disabled={disabled}
        className={cn(hotkeyInput, iconOverlay && 'text-transparent')}
        value={recording ? '…' : summary}
        placeholder="—"
        aria-label={label}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onContextMenu={(event) => {
          if (recording) event.preventDefault()
        }}
      />
      {iconOverlay ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-[0.8125rem] text-ink" aria-hidden>
          <KeyText text={summary} />
        </span>
      ) : null}
      {summary ? (
        <button type="button" className={hotkeyClearBtn} aria-label={`清除${label}`} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => finish([])}>
          <IoCloseOutline size={15} aria-hidden />
        </button>
      ) : null}
    </span>
  )

  return (
    <div className="grid min-w-0 gap-1">
      {!compact ? <span className="text-xs font-medium text-ink">{label}</span> : null}
      {warning && compact ? <Tooltip content={warning}>{field}</Tooltip> : field}
      {warning && !compact ? <p className="text-xs text-warn">{warning}</p> : null}
    </div>
  )
}
