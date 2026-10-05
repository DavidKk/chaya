/**
 * Recent story log for agents (`game.history`): rendered dialogue, choices, map changes, battles and loads.
 * Recorded at render time, so dialogue the player fast-forwarded or skipped is kept too. Local only.
 */

import { AGENT_HISTORY_DEFAULT, AGENT_HISTORY_KINDS, AGENT_HISTORY_MAX, type AgentHistoryKind, type AgentParams } from '@/lib/runtime/agent-protocol'

import { detectGameIdentity } from '../helpers'
import { hookMethod } from '../helpers/game/method-hook'

export type HistoryEntry = {
  seq: number
  at: number
  playtime?: string
  kind: AgentHistoryKind
  speaker?: string
  text?: string
  choices?: string[]
  index?: number
  mapId?: number
  mapName?: string
  result?: string
  slot?: number
  /** Consecutive identical messages merged into one entry */
  repeat?: number
}

type Loose = Record<string, unknown>
type AnyFn = (...args: unknown[]) => unknown

const TEXT_MAX = 1000
const PERSIST_MS = 5_000
const STORAGE_PREFIX = 'chaya.agent.history:'

let entries: HistoryEntry[] = []
let seq = 0
let dirty = false

const g = () => globalThis as unknown as Loose

function call<T>(obj: unknown, name: string, ...args: unknown[]): T | undefined {
  try {
    const fn = (obj as Loose | null | undefined)?.[name]
    return typeof fn === 'function' ? ((fn as AnyFn).apply(obj, args) as T) : undefined
  } catch {
    return undefined
  }
}

/** RPG Maker control codes → plain text; does not use `convertEscapeCharacters` (the translator hooks it). */
export function plainText(raw: unknown): string {
  const w = g()
  let text = String(raw ?? '')
  for (let i = 0; i < 3 && /\\V\[\d+\]/i.test(text); i++) text = text.replace(/\\V\[(\d+)\]/gi, (_, n) => String(call(w.$gameVariables, 'value', Number(n)) ?? ''))
  text = text
    .replace(/\\N\[(\d+)\]/gi, (_, n) => String(call(call(w.$gameActors, 'actor', Number(n)), 'name') ?? ''))
    .replace(/\\P\[(\d+)\]/gi, (_, n) => String(call((call<unknown[]>(w.$gameParty, 'members') ?? [])[Number(n) - 1], 'name') ?? ''))
    .replace(/\\G/gi, String((w.TextManager as Loose | undefined)?.currencyUnit ?? ''))
    .replace(/\\\\/g, '\u0000')
    .replace(/\\[A-Za-z]+\[[^\]]*\]/g, '')
    .replace(/\\[{}!.|^<>$]/g, '')
    .replace(/\u0000/g, '\\')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text
}

function storageKey(): string {
  const title = (g().$dataSystem as { gameTitle?: string } | undefined)?.gameTitle || document.title
  return STORAGE_PREFIX + `${title}|${detectGameIdentity()?.gameRoot || location.pathname}`
}

function push(entry: Omit<HistoryEntry, 'seq' | 'at' | 'playtime'>) {
  const last = entries[entries.length - 1]
  if (entry.kind === 'message' && last?.kind === 'message' && last.text === entry.text && last.speaker === entry.speaker) {
    last.repeat = (last.repeat ?? 1) + 1
    last.at = Date.now()
    dirty = true
    return
  }
  const playtime = call<string>(g().$gameSystem, 'playtimeText')
  entries.push({ seq: ++seq, at: Date.now(), ...(playtime ? { playtime } : {}), ...entry })
  if (entries.length > AGENT_HISTORY_MAX) entries = entries.slice(-AGENT_HISTORY_MAX)
  dirty = true
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null') as { seq?: number; entries?: HistoryEntry[] } | null
    if (!saved || !Array.isArray(saved.entries)) return
    entries = saved.entries.filter((e) => e && typeof e.seq === 'number' && AGENT_HISTORY_KINDS.includes(e.kind)).slice(-AGENT_HISTORY_MAX)
    seq = Math.max(Number(saved.seq) || 0, entries[entries.length - 1]?.seq ?? 0)
  } catch {
    /* corrupt or unavailable storage: start fresh */
  }
}

function persist() {
  if (!dirty) return
  dirty = false
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ seq, entries }))
  } catch {
    /* quota / private mode */
  }
}

function mapName(mapId: number): string | undefined {
  const infos = g().$dataMapInfos as Array<{ name?: string } | null> | undefined
  return call<string>(g().$gameMap, 'displayName') || infos?.[mapId]?.name || undefined
}

function installHooks(): Array<() => void> {
  const w = g()
  const remove: Array<() => void> = []
  const proto = (name: string) => (w[name] as { prototype?: object } | undefined)?.prototype
  const after = (target: object | undefined, key: string, fn: (result: unknown, args: unknown[], self: unknown) => void) => {
    if (!target) return
    remove.push(
      hookMethod(
        target,
        key,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            const result = original.apply(this, args)
            try {
              fn(result, args, this)
            } catch {
              /* recording must never break the game */
            }
            return result
          }
      )
    )
  }
  const before = (target: object | undefined, key: string, fn: (args: unknown[]) => void) => {
    if (!target) return
    remove.push(
      hookMethod(
        target,
        key,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            try {
              fn(args)
            } catch {
              /* */
            }
            return original.apply(this, args)
          }
      )
    )
  }

  before(proto('Window_Message'), 'startMessage', () => {
    const message = w.$gameMessage
    const text = plainText(call(message, 'allText'))
    if (!text) return
    const speaker = plainText(call(message, 'speakerName') ?? '')
    push({ kind: 'message', text, ...(speaker ? { speaker } : {}) })
  })
  after(proto('Window_ChoiceList'), 'start', () => {
    const choices = (call<unknown[]>(w.$gameMessage, 'choices') ?? []).map(plainText)
    if (choices.length) push({ kind: 'choices', choices })
  })
  before(proto('Game_Message'), 'onChoice', ([n]) => {
    const index = Number(n)
    const choices = call<unknown[]>(w.$gameMessage, 'choices') ?? []
    push({ kind: 'choice', index, ...(choices[index] != null ? { text: plainText(choices[index]) } : {}) })
  })
  after(proto('Game_Map'), 'setup', (_result, [id]) => {
    const mapId = Number(id)
    push({ kind: 'map', mapId, ...(mapName(mapId) ? { mapName: mapName(mapId) } : {}) })
  })
  const battle = w.BattleManager as object | undefined
  after(battle, 'setup', (_result, [troopId]) => {
    const troops = w.$dataTroops as Array<{ name?: string } | null> | undefined
    const enemies = (call<string[]>(w.$gameTroop, 'enemyNames') ?? []).join('、')
    push({ kind: 'battle', result: 'start', text: enemies || troops?.[Number(troopId)]?.name || undefined })
  })
  after(battle, 'processVictory', () => push({ kind: 'battle', result: 'victory' }))
  after(battle, 'processDefeat', () => push({ kind: 'battle', result: 'defeat' }))
  after(battle, 'processEscape', (ok) => push({ kind: 'battle', result: ok === false ? 'escape_failed' : 'escape' }))
  after(w.DataManager as object | undefined, 'loadGame', (result, [slot]) => {
    const record = () => push({ kind: 'load', slot: Number(slot) })
    if (result && typeof (result as Promise<unknown>).then === 'function') void (result as Promise<unknown>).then(record, () => {})
    else if (result) record()
  })
  return remove
}

export function startHistory(): () => void {
  restore()
  const remove = installHooks()
  const timer = window.setInterval(persist, PERSIST_MS)
  return () => {
    window.clearInterval(timer)
    persist()
    for (const undo of remove) undo()
  }
}

function translated(text: string): string | undefined {
  const translate = (window as Window & { ChayaTrans?: { translate?: (t: string) => string } }).ChayaTrans?.translate
  if (typeof translate !== 'function') return undefined
  try {
    const out = translate(text)
    return out && out !== text ? out : undefined
  } catch {
    return undefined
  }
}

export function readHistory({ limit, kinds, afterSeq }: AgentParams<'game.history'>) {
  const n = Math.min(AGENT_HISTORY_MAX, Math.max(1, Math.round(Number(limit ?? AGENT_HISTORY_DEFAULT)) || AGENT_HISTORY_DEFAULT))
  const wanted = Array.isArray(kinds) ? kinds.filter((k) => AGENT_HISTORY_KINDS.includes(k)) : []
  const after = Number(afterSeq)
  const picked = entries.filter((e) => (!wanted.length || wanted.includes(e.kind)) && (!Number.isFinite(after) || e.seq > after)).slice(-n)
  return {
    entries: picked.map((e) => {
      const text = e.text ? translated(e.text) : undefined
      const choices = e.choices?.map((c) => translated(c) ?? c)
      const changed = choices && choices.some((c, i) => c !== e.choices?.[i])
      return { ...e, ...(text ? { translated: text } : {}), ...(changed ? { translatedChoices: choices } : {}) }
    }),
    lastSeq: seq,
    dropped: Math.max(0, (entries[0]?.seq ?? seq + 1) - 1),
  }
}

/** Test hook */
export function resetHistory() {
  entries = []
  seq = 0
  dirty = false
}
