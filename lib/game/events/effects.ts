import type { EventCommand } from './types'

/** Game data a command list changes; used to assess risk before running it */
export type EventEffects = {
  switches: number[]
  variables: number[]
  selfSwitch: boolean
  gold: boolean
  items: boolean
  party: boolean
  actorName: boolean
  transfers: number[]
  battle: boolean
  gameOver: boolean
  title: boolean
  save: boolean
  script: boolean
  plugin: boolean
  calls: number[]
}

const num = (value: unknown) => Math.floor(Number(value) || 0)

function pushRange(target: Set<number>, start: unknown, end: unknown) {
  const from = num(start)
  const to = Math.max(from, num(end))
  for (let id = from; id <= to && id - from < 200; id++) if (id > 0) target.add(id)
}

export function summarizeEffects(list: readonly EventCommand[]): EventEffects {
  const switches = new Set<number>()
  const variables = new Set<number>()
  const transfers = new Set<number>()
  const calls = new Set<number>()
  const out: EventEffects = {
    switches: [],
    variables: [],
    selfSwitch: false,
    gold: false,
    items: false,
    party: false,
    actorName: false,
    transfers: [],
    battle: false,
    gameOver: false,
    title: false,
    save: false,
    script: false,
    plugin: false,
    calls: [],
  }
  for (const cmd of list) {
    const p = cmd.parameters
    switch (cmd.code) {
      case 121:
        pushRange(switches, p[0], p[1])
        break
      case 122:
        pushRange(variables, p[0], p[1])
        break
      case 123:
        out.selfSwitch = true
        break
      case 125:
        out.gold = true
        break
      case 126:
      case 127:
      case 128:
        out.items = true
        break
      case 129:
        out.party = true
        break
      case 303:
      case 320:
        out.actorName = true
        break
      case 201:
        if (num(p[0]) === 0 && num(p[1]) > 0) transfers.add(num(p[1]))
        else out.transfers.push(0)
        break
      case 301:
        out.battle = true
        break
      case 353:
        out.gameOver = true
        break
      case 354:
        out.title = true
        break
      case 352:
        out.save = true
        break
      case 355:
        out.script = true
        break
      case 356:
      case 357:
        out.plugin = true
        break
      case 117:
        if (num(p[0]) > 0) calls.add(num(p[0]))
        break
    }
  }
  const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b)
  out.switches = sorted(switches)
  out.variables = sorted(variables)
  out.transfers = [...sorted(transfers), ...out.transfers]
  out.calls = sorted(calls)
  return out
}

/** Transfer, battle, game over, return to title, save screen: require confirmation before running */
export function isRiskyEffects(effects: EventEffects): boolean {
  return effects.transfers.length > 0 || effects.battle || effects.gameOver || effects.title || effects.save
}

export function hasEffects(effects: EventEffects): boolean {
  return (
    effects.switches.length > 0 ||
    effects.variables.length > 0 ||
    effects.selfSwitch ||
    effects.gold ||
    effects.items ||
    effects.party ||
    effects.actorName ||
    effects.script ||
    effects.plugin ||
    isRiskyEffects(effects)
  )
}
