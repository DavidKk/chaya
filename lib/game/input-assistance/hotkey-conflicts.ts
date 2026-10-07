import type { InputChord } from './types'

/** A Chaya hotkey as stored on the hotkeys page (`Ctrl+Shift+J`, `` ` ``, `Alt+3`) */
export type ProductBinding = { label: string; chord: string }

const MODIFIERS: Record<string, string> = { ctrl: 'ctrl', control: 'ctrl', meta: 'ctrl', cmd: 'ctrl', command: 'ctrl', alt: 'alt', option: 'alt', opt: 'alt', shift: 'shift' }

/** Hotkey-page chord → comparable tokens; Meta counts as Ctrl like the hotkey matcher does */
export function hotkeyTokens(chord: string): string[] {
  const text = chord.trim()
  if (!text) return []
  const plusKey = text.endsWith('+') && text.length > 1
  const parts = text.split('+').filter(Boolean)
  if (plusKey) parts.push('+')
  return [...new Set(parts.map((part) => MODIFIERS[part.toLowerCase()] ?? (part === ' ' ? 'space' : part.toLowerCase())))]
}

/** Key-mouse chord (physical keys) → the same tokens; mouse buttons stay distinct */
export function inputChordTokens(chord: InputChord): string[] {
  return [
    ...new Set(
      chord.map((atom) => {
        if (atom.kind === 'mouse') return `mouse:${atom.button}`
        const code = atom.code
        if (/^(Control|Meta|OS)/.test(code)) return 'ctrl'
        if (code.startsWith('Alt')) return 'alt'
        if (code.startsWith('Shift')) return 'shift'
        const digit = /^Digit([0-9])$/.exec(code)
        if (digit) return digit[1]
        const letter = /^Key([A-Z])$/.exec(code)
        if (letter) return letter[1].toLowerCase()
        if (code === 'Backquote') return '`'
        if (code === 'Space' || atom.key === ' ') return 'space'
        return (atom.key || code).toLowerCase()
      })
    ),
  ]
}

/** Pressing one also holds every key of the other (equal, or one contains the other) */
export function tokensOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (!a.length || !b.length) return false
  const left = new Set(a)
  const right = new Set(b)
  return a.every((token) => right.has(token)) || b.every((token) => left.has(token))
}
