import { KEY_CHARS_MAX, PATH_DEPTH_MAX } from './limits'
import type { DataPath } from './types'

/** Root fields, in display order; values are the engine globals they resolve to */
export const DATA_ROOTS = [
  ['system', '$gameSystem'],
  ['screen', '$gameScreen'],
  ['timer', '$gameTimer'],
  ['switches', '$gameSwitches'],
  ['variables', '$gameVariables'],
  ['selfSwitches', '$gameSelfSwitches'],
  ['actors', '$gameActors'],
  ['party', '$gameParty'],
  ['map', '$gameMap'],
  ['player', '$gamePlayer'],
  ['config', 'ConfigManager'],
] as const

export type DataRootKey = (typeof DATA_ROOTS)[number][0]

const ROOT_GLOBALS = new Map<string, string>(DATA_ROOTS)

export const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isRootKey(key: string): key is DataRootKey {
  return ROOT_GLOBALS.has(key)
}

export function pathKey(path: readonly string[]): string {
  return JSON.stringify(path)
}

export function parsePathKey(key: string): DataPath {
  return JSON.parse(key) as DataPath
}

export function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i])
}

export function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => seg === path[i])
}

export function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= KEY_CHARS_MAX && !RESERVED_KEYS.has(key)
}

/** Structural checks only; whether the path exists is answered by the game */
export function isValidPath(path: unknown): path is DataPath {
  if (!Array.isArray(path) || path.length > PATH_DEPTH_MAX) return false
  if (path.length > 0 && !isRootKey(path[0])) return false
  return path.every(isValidKey)
}

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]$/

/**
 * URL segment encoding that only emits `[A-Za-z0-9_.-~]`, so it reads the same whether or not the router
 * already percent-decoded the params. Other characters become `~` + UTF-8 hex bytes.
 */
export function encodeSegment(seg: string): string {
  let out = ''
  for (const ch of seg) {
    if (SAFE_SEGMENT.test(ch)) {
      out += ch
      continue
    }
    for (const byte of new TextEncoder().encode(ch)) out += `~${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

export function decodeSegment(seg: string): string | null {
  if (!/^(?:[A-Za-z0-9_.-]|~[0-9A-Fa-f]{2})*$/.test(seg)) return null
  const bytes: number[] = []
  let out = ''
  const flush = () => {
    if (!bytes.length) return
    out += new TextDecoder().decode(new Uint8Array(bytes))
    bytes.length = 0
  }
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] === '~') {
      bytes.push(parseInt(seg.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      flush()
      out += seg[i]
    }
  }
  flush()
  return out
}

export function decodePathSegments(segments: readonly string[]): DataPath | null {
  const path: string[] = []
  for (const seg of segments) {
    const key = decodeSegment(seg)
    if (key == null) return null
    path.push(key)
  }
  return isValidPath(path) ? path : null
}

/** Always-shown shortcuts on the data page (playtime is derived from frame count, not a save field) */
export const PRESET_PINS: readonly DataPath[] = [
  ['party', '_gold'],
  ['party', '_steps'],
  ['timer', '_frames'],
  ['player', '_x'],
  ['player', '_y'],
  ['player', '_encounterCount'],
  ['system', '_saveCount'],
]

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Expression usable in the game console, e.g. `$gameParty._items[12]` */
export function pathExpression(path: readonly string[]): string {
  if (!path.length) return ''
  let out = ROOT_GLOBALS.get(path[0]) ?? path[0]
  for (const seg of path.slice(1)) {
    if (/^(0|[1-9]\d*)$/.test(seg)) out += `[${seg}]`
    else if (IDENT.test(seg)) out += `.${seg}`
    else out += `[${JSON.stringify(seg)}]`
  }
  return out
}
