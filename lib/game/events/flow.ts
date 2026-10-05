/**
 * Which commands of a list will run against the current game state: conditional branches are
 * evaluated, switch / variable / self-switch changes made earlier in the list are carried along.
 */
import type { EventCommand } from './types'

/** run: will execute · skip: branch not taken · maybe: depends on something unknown (choice, unreadable condition) */
export type FlowMark = 'run' | 'skip' | 'maybe'

export type FlowState = {
  switches: Readonly<Record<number, boolean>>
  vars: Readonly<Record<number, number>>
  /** Self switches that are ON for this event, e.g. "AC"; null when not applicable */
  self: string | null
  gold?: number
  itemCount?: (id: number) => number | undefined
}

export type FlowResult = {
  /** Per command index */
  marks: FlowMark[]
  /** Per conditional (111) index: true / false, null when unknown */
  conds: Record<number, boolean | null>
  /** Per branch header (111 / 411 / 402 / 403 / 601–603) index: how its body runs */
  bodies: Record<number, FlowMark>
}

const num = (v: unknown) => Math.floor(Number(v) || 0)

function compare(a: number, b: number, op: number): boolean | null {
  switch (op) {
    case 0:
      return a === b
    case 1:
      return a >= b
    case 2:
      return a <= b
    case 3:
      return a > b
    case 4:
      return a < b
    case 5:
      return a !== b
    default:
      return null
  }
}

/** Common event call, script, plugin command: may change anything we track */
const OPAQUE = new Set([117, 355, 356, 357])

/** Mutable simulation of the readable game state; `undefined` = unknown */
class Sim {
  sw = new Map<number, boolean | undefined>()
  vr = new Map<number, number | undefined>()
  self = new Map<string, boolean | undefined>()
  gold: number | undefined
  items = new Map<number, number | undefined>()
  /** Base values no longer trusted after an opaque command */
  private lost = false
  constructor(private readonly base: FlowState | null) {
    this.gold = base?.gold
  }

  private known() {
    return this.base && !this.lost ? this.base : null
  }
  switch(id: number): boolean | undefined {
    if (this.sw.has(id)) return this.sw.get(id)
    const b = this.known()
    return b ? !!b.switches[id] : undefined
  }
  variable(id: number): number | undefined {
    if (this.vr.has(id)) return this.vr.get(id)
    const b = this.known()
    return b ? (b.vars[id] ?? 0) : undefined
  }
  selfSwitch(ch: string): boolean | undefined {
    if (this.self.has(ch)) return this.self.get(ch)
    const b = this.known()
    return b?.self == null ? undefined : b.self.includes(ch)
  }
  item(id: number): number | undefined {
    if (this.items.has(id)) return this.items.get(id)
    return this.known()?.itemCount?.(id)
  }

  /** Forget everything: later reads are unknown unless set again in the list */
  private forget() {
    this.lost = true
    this.sw.clear()
    this.vr.clear()
    this.self.clear()
    this.items.clear()
    this.gold = undefined
  }

  cond(p: readonly unknown[]): boolean | null {
    const known = <T>(v: T | undefined, f: (v: T) => boolean | null) => (v === undefined ? null : f(v))
    switch (num(p[0])) {
      case 0:
        return known(this.switch(num(p[1])), (v) => v === (num(p[2]) === 0))
      case 1: {
        const left = this.variable(num(p[1]))
        const right = num(p[2]) === 0 ? num(p[3]) : this.variable(num(p[3]))
        return left === undefined || right === undefined ? null : compare(left, right, num(p[4]))
      }
      case 2:
        return known(this.selfSwitch(String(p[1])), (v) => v === (num(p[2]) === 0))
      case 7:
        return known(this.gold, (v) => compare(v, num(p[1]), [1, 2, 4][num(p[2])] ?? -1))
      case 8:
        return known(this.item(num(p[1])), (v) => v > 0)
      default:
        return null
    }
  }

  /** Apply a change command; `sure` false marks the touched values unknown */
  apply(cmd: EventCommand, sure: boolean) {
    const p = cmd.parameters
    if (cmd.code === 121) {
      for (let id = num(p[0]); id <= Math.max(num(p[0]), num(p[1])); id++) this.sw.set(id, sure ? num(p[2]) === 0 : undefined)
    } else if (cmd.code === 122) {
      for (let id = num(p[0]); id <= Math.max(num(p[0]), num(p[1])); id++) this.vr.set(id, sure ? this.nextVar(id, p) : undefined)
    } else if (cmd.code === 123) {
      this.self.set(String(p[0]), sure ? num(p[1]) === 0 : undefined)
    } else if (cmd.code === 125) {
      const delta = this.operand(p[1], p[2])
      this.gold = sure && this.gold !== undefined && delta !== undefined ? Math.max(0, this.gold + (num(p[0]) === 0 ? delta : -delta)) : undefined
    } else if (cmd.code === 126) {
      const id = num(p[0])
      const cur = this.item(id)
      const delta = this.operand(p[2], p[3])
      this.items.set(id, sure && cur !== undefined && delta !== undefined ? Math.max(0, cur + (num(p[1]) === 0 ? delta : -delta)) : undefined)
    } else if (OPAQUE.has(cmd.code)) {
      this.forget()
    }
  }

  /** Gold / item amount: constant or a variable's value */
  private operand(type: unknown, value: unknown): number | undefined {
    return num(type) === 0 ? num(value) : this.variable(num(value))
  }

  private nextVar(id: number, p: readonly unknown[]): number | undefined {
    const operand = num(p[3]) === 0 ? num(p[4]) : num(p[3]) === 1 ? this.variable(num(p[4])) : undefined
    const cur = this.variable(id)
    if (operand === undefined || (num(p[2]) !== 0 && cur === undefined)) return undefined
    const c = cur ?? 0
    switch (num(p[2])) {
      case 0:
        return operand
      case 1:
        return c + operand
      case 2:
        return c - operand
      case 3:
        return c * operand
      case 4:
        return operand ? Math.floor(c / operand) : c
      case 5:
        return operand ? c % operand : c
      default:
        return undefined
    }
  }
}

function within(parent: FlowMark, taken: boolean | null): FlowMark {
  if (parent === 'skip' || taken === false) return 'skip'
  return taken === true ? parent : 'maybe'
}

/** `state` null (offline): conditions are unknown, so every branch body is "maybe" */
export function analyzeFlow(list: readonly EventCommand[], state: FlowState | null): FlowResult {
  const sim = new Sim(state)
  const marks: FlowMark[] = []
  const conds: FlowResult['conds'] = {}
  const bodies: FlowResult['bodies'] = {}
  /** Mark for commands at each indent; set by the header that opens that level */
  const level: FlowMark[] = ['run']
  /** Last condition result per indent, for the matching else (411) */
  const lastCond: (boolean | null)[] = []

  list.forEach((cmd, i) => {
    const k = Math.max(0, cmd.indent)
    const mark = level[k] ?? 'maybe'
    marks[i] = mark
    let body: FlowMark | null = null
    switch (cmd.code) {
      case 111: {
        const r = mark === 'skip' ? null : sim.cond(cmd.parameters)
        conds[i] = r
        lastCond[k] = r
        body = within(mark, r)
        break
      }
      case 411: {
        const r = lastCond[k]
        body = within(mark, r == null ? null : !r)
        break
      }
      case 402:
      case 403:
      case 601:
      case 602:
      case 603:
        body = within(mark, null)
        break
      case 112:
        body = mark
        break
      default:
        if (mark !== 'skip') sim.apply(cmd, mark === 'run')
    }
    if (body) {
      level[k + 1] = body
      if (cmd.code !== 112) bodies[i] = body
    }
  })
  return { marks, conds, bodies }
}

/** Header of the branch we are inside → later headers at the same indent that are its siblings */
const SIBLINGS: Record<number, readonly number[]> = { 111: [411], 402: [402, 403], 403: [402, 403], 601: [601, 602, 603], 602: [601, 602, 603], 603: [601, 602, 603] }
/** End of choice / if / battle-result blocks */
const BLOCK_END = new Set([404, 412, 604])

/**
 * Commands that can run when the list starts at `from`: the branches enclosing it are entered, so their
 * sibling branches further down (other choices, the else of a taken if, other battle results) are left out.
 */
export function reachableFrom(list: readonly EventCommand[], from: number): EventCommand[] {
  const at = Math.max(0, Math.floor(from))
  const skipAt = new Map<number, readonly number[]>()
  let indent = (list[at]?.indent ?? 0) + 1
  for (let i = at; i >= 0 && indent > 0; i--) {
    if (list[i].indent >= indent) continue
    indent = list[i].indent
    const siblings = SIBLINGS[list[i].code]
    // Starting on an if evaluates it normally, so either side may run
    if (siblings && !(i === at && list[i].code === 111)) skipAt.set(indent, siblings)
  }
  const out: EventCommand[] = []
  let skipBelow = -1
  for (let i = at; i < list.length; i++) {
    const cmd = list[i]
    if (skipBelow >= 0 && cmd.indent > skipBelow) continue
    skipBelow = -1
    if (i > at && skipAt.get(cmd.indent)?.includes(cmd.code)) {
      skipBelow = cmd.indent
      continue
    }
    if (BLOCK_END.has(cmd.code)) skipAt.delete(cmd.indent)
    out.push(cmd)
  }
  return out
}

/** Values a variable is compared against or set to in a list, for quick picking */
export function variableCandidates(list: readonly EventCommand[], id: number): number[] {
  const out = new Set<number>()
  for (const { code, parameters: p } of list) {
    if (code === 111 && num(p[0]) === 1 && num(p[1]) === id && num(p[2]) === 0) out.add(num(p[3]))
    if (code === 122 && num(p[0]) <= id && id <= Math.max(num(p[0]), num(p[1])) && num(p[2]) === 0 && num(p[3]) === 0) out.add(num(p[4]))
  }
  return [...out].sort((a, b) => a - b)
}
