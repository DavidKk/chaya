import { assistFiresOnHotkey, hotkeyTokens, inputChordTokens, type ProductBinding } from './hotkey-conflicts'
import {
  type BindingWarning,
  EMPTY_INPUT_ASSIST_CONFIG,
  type InputAssistConfig,
  type InputAtom,
  type InputChord,
  type InputRule,
  type MacroEvent,
  type MacroRule,
  MAX_INPUT_RULES,
  MAX_MACRO_EVENTS,
  MAX_MACRO_STEPS,
  MAX_REPEAT_MS,
  MIN_REPEAT_MS,
  type RuleGroup,
  type RuleIssue,
  type TurboRule,
} from './types'

export function atomId(input: InputAtom): string {
  return input.kind === 'key' ? `key:${input.code}:${input.location ?? 0}` : `mouse:${input.button}`
}

export function atomLabel(input: InputAtom): string {
  if (input.kind === 'mouse') return ['左键', '中键', '右键'][input.button]
  const key = input.key === ' ' ? 'Space' : input.key === '+' ? 'Plus' : input.key || input.code.replace(/^Key/, '')
  return key.length === 1 ? key.toUpperCase() : key
}

export function chordLabel(chord: readonly InputAtom[]): string {
  return chord.map(atomLabel).join('+')
}

export function chordId(chord: readonly InputAtom[]): string {
  return chord.map(atomId).sort().join('|')
}

export function groupForRule(rule: InputRule): RuleGroup {
  return rule.kind === 'macro' ? 'action' : rule.kind
}

export function intervalLabel({ minMs, maxMs }: TurboRule['interval']): string {
  return minMs === maxMs ? String(minMs) : `${minMs}-${maxMs}`
}

/** 解析 “100” 或 “100-130”；超出范围夹到 [MIN_REPEAT_MS, MAX_REPEAT_MS]，无效返回 null */
export function parseInterval(text: string): TurboRule['interval'] | null {
  const match = /^\s*(\d+)\s*(?:[-–~～]\s*(\d+))?\s*(?:ms)?\s*$/i.exec(text)
  if (!match) return null
  const clamp = (value: number) => Math.min(MAX_REPEAT_MS, Math.max(MIN_REPEAT_MS, value))
  const a = clamp(Number(match[1]))
  const b = clamp(Number(match[2] ?? match[1]))
  return { minMs: Math.min(a, b), maxMs: Math.max(a, b) }
}

export function randomInterval({ minMs, maxMs }: TurboRule['interval']): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1))
}

export type MacroStep = { inputs: InputAtom[]; startMs: number; endMs: number; gapMs: number }

/** 每次按下单独成步；同一毫秒按下的才合为一步（组合键）。gapMs 为距上一步按下的时间 */
export function macroSteps(events: readonly MacroEvent[]): MacroStep[] {
  const steps: MacroStep[] = []
  const stepOf = new Map<string, MacroStep>()
  for (const event of events) {
    const id = atomId(event.input)
    if (event.phase === 'down') {
      let step = steps[steps.length - 1]
      if (!step || step.startMs !== event.atMs) {
        step = { inputs: [], startMs: event.atMs, endMs: event.atMs, gapMs: step ? event.atMs - step.startMs : 0 }
        steps.push(step)
      }
      step.inputs.push(event.input)
      stepOf.set(id, step)
    } else {
      const step = stepOf.get(id)
      if (step) step.endMs = Math.max(step.endMs, event.atMs)
      stepOf.delete(id)
    }
  }
  return steps
}

/** 不同步的按下至少相隔一帧，单次按住至少一帧多，否则游戏在同一帧读到会丢失先后或漏键 */
export const MIN_STEP_GAP_MS = 17
export const MIN_PRESS_MS = 24
/** 按下时间差不超过此值视为同时按下（组合键） */
export const SIMULTANEOUS_MS = 2

export function spaceMacroEvents(events: readonly MacroEvent[]): MacroEvent[] {
  let shift = 0
  let stepRaw = -Infinity
  let stepAt = -Infinity
  const downAt = new Map<string, number>()
  const upAt = new Map<string, number>()
  const spaced = events.map((event, index) => {
    const id = atomId(event.input)
    let at = event.atMs + shift
    if (event.phase === 'down') {
      if (event.atMs - stepRaw <= SIMULTANEOUS_MS && (upAt.get(id) ?? -Infinity) < stepAt) at = stepAt
      else {
        at = Math.max(at, stepAt + MIN_STEP_GAP_MS, (upAt.get(id) ?? -Infinity) + 1)
        shift = at - event.atMs
        stepRaw = event.atMs
        stepAt = at
      }
      downAt.set(id, at)
    } else {
      at = Math.max(at, (downAt.get(id) ?? at) + MIN_PRESS_MS)
      upAt.set(id, at)
    }
    return { event: { ...event, atMs: Math.min(60_000, at) }, index }
  })
  return spaced.sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index).map((item) => item.event)
}

export function macroLabel(events: readonly MacroEvent[]): string {
  const steps = macroSteps(events)
  if (steps.every((step) => step.inputs.length === 1 && atomLabel(step.inputs[0]).length === 1)) return steps.map((step) => atomLabel(step.inputs[0])).join('')
  return steps.map((step) => chordLabel(step.inputs)).join(' ')
}

export function macroTimingBadge(events: readonly MacroEvent[]): string | null {
  const steps = macroSteps(events)
  if (steps.length < 2) return null
  const gaps = steps.slice(1).map((step) => Math.round(step.gapMs))
  return gaps.every((gap) => gap === gaps[0]) ? String(gaps[0]) : '…'
}

export function repeatLabel(rule: MacroRule): '连发' | '连点' | '循环' {
  const steps = macroSteps(rule.events)
  if (steps.length === 1 && steps[0].inputs.length === 1) return steps[0].inputs[0].kind === 'mouse' ? '连点' : '连发'
  return '循环'
}

function validAtom(value: unknown): value is InputAtom {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<InputAtom>
  if (input.kind === 'mouse') return Number.isInteger(input.button) && input.button! >= 0 && input.button! <= 2
  return (
    input.kind === 'key' &&
    typeof input.code === 'string' &&
    input.code.length > 0 &&
    input.code.length <= 50 &&
    typeof input.key === 'string' &&
    input.key.length <= 50 &&
    Number.isInteger(input.keyCode) &&
    input.keyCode! >= 0 &&
    input.keyCode! <= 255 &&
    (input.location === undefined || (Number.isInteger(input.location) && input.location >= 0 && input.location <= 3))
  )
}

function validChord(value: unknown): value is InputChord {
  return Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every(validAtom) && new Set(value.map(atomId)).size === value.length
}

function validInterval(value: unknown): value is TurboRule['interval'] {
  if (!value || typeof value !== 'object') return false
  const { minMs, maxMs } = value as Partial<TurboRule['interval']>
  return Number.isInteger(minMs) && Number.isInteger(maxMs) && minMs! >= MIN_REPEAT_MS && maxMs! <= MAX_REPEAT_MS && minMs! <= maxMs!
}

export function validateRule(rule: InputRule, runnable = true): RuleIssue[] {
  const issues: RuleIssue[] = []
  if (!validChord(rule.trigger)) issues.push({ field: 'trigger', message: '请录制有效的触发键' })
  if (rule.kind === 'mapping') {
    if (!validChord(rule.output)) issues.push({ field: 'output', message: '请录制映射输出' })
    return runnable ? issues : []
  }
  if (rule.kind === 'turbo') {
    if (!validChord(rule.output) || rule.output.length !== 1) issues.push({ field: 'output', message: '请录制一个连发按键' })
    if (!validInterval(rule.interval)) issues.push({ field: 'interval', message: `连发间隔需为 ${MIN_REPEAT_MS}–${MAX_REPEAT_MS} ms` })
    return runnable ? issues : issues.filter((issue) => issue.field === 'interval')
  }
  if (!Array.isArray(rule.events) || rule.events.length < 2 || rule.events.length > MAX_MACRO_EVENTS) {
    issues.push({ field: 'output', message: '请录制完整的宏动作' })
  } else {
    const held = new Set<string>()
    let lastAt = -1
    for (const event of rule.events) {
      if (!event || !validAtom(event.input) || !Number.isFinite(event.atMs) || event.atMs < lastAt || event.atMs > 60_000) {
        issues.push({ field: 'output', message: '录制时间或按键无效' })
        break
      }
      lastAt = event.atMs
      const id = atomId(event.input)
      if (event.phase === 'down' && !held.has(id)) held.add(id)
      else if (event.phase === 'up' && held.has(id)) held.delete(id)
      else {
        issues.push({ field: 'output', message: '宏中有未配对的按下或松开' })
        break
      }
    }
    if (held.size) issues.push({ field: 'output', message: '宏中有未松开的按键' })
    if (!issues.some((issue) => issue.field === 'output') && macroSteps(rule.events).length > MAX_MACRO_STEPS)
      issues.push({ field: 'output', message: `宏最多 ${MAX_MACRO_STEPS} 步` })
  }
  if (rule.repeat.enabled && (!Number.isInteger(rule.repeat.intervalMs) || rule.repeat.intervalMs < MIN_REPEAT_MS || rule.repeat.intervalMs > MAX_REPEAT_MS)) {
    issues.push({ field: 'repeat', message: `重复间隔需为 ${MIN_REPEAT_MS}–${MAX_REPEAT_MS} ms` })
  }
  if (rule.repeat.enabled && rule.stop?.mode === 'separate' && !validChord(rule.stop.binding)) issues.push({ field: 'stop', message: '请录制有效的停止键' })
  return runnable ? issues : issues.filter((issue) => issue.field !== 'trigger' && issue.field !== 'output' && issue.field !== 'stop')
}

export function parseInputAssistConfig(raw: unknown): InputAssistConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
  const value = raw as Partial<InputAssistConfig>
  if (value.version !== 1 || !Array.isArray(value.rules)) return { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
  const rules = value.rules.slice(0, MAX_INPUT_RULES).filter((rule): rule is InputRule => {
    if (!rule || typeof rule !== 'object') return false
    if (rule.kind !== 'mapping' && rule.kind !== 'macro' && rule.kind !== 'turbo') return false
    if (typeof rule.id !== 'string' || !rule.id || rule.id.length > 80 || typeof rule.name !== 'string' || rule.name.length > 80) return false
    if (typeof rule.enabled !== 'boolean' || (rule.originalInput !== 'replace' && rule.originalInput !== 'keep')) return false
    if (!Array.isArray(rule.trigger) || (rule.trigger.length > 0 && !validChord(rule.trigger))) return false
    if (rule.kind === 'mapping') return Array.isArray(rule.output) && (rule.output.length === 0 || validChord(rule.output))
    if (rule.kind === 'turbo')
      return Array.isArray(rule.output) && (rule.output.length === 0 || (rule.output.length === 1 && validChord(rule.output))) && validInterval(rule.interval)
    if (
      !Array.isArray(rule.events) ||
      rule.events.length > MAX_MACRO_EVENTS ||
      !rule.repeat ||
      typeof rule.repeat.enabled !== 'boolean' ||
      !Number.isFinite(rule.repeat.intervalMs)
    )
      return false
    if (rule.mousePosition !== 'current' && rule.mousePosition !== 'start') return false
    if (
      rule.stop &&
      rule.stop.mode !== 'same-trigger' &&
      (rule.stop.mode !== 'separate' || !Array.isArray(rule.stop.binding) || (rule.stop.binding.length > 0 && !validChord(rule.stop.binding)))
    )
      return false
    return rule.events.length === 0 || !validateRule(rule, false).some((issue) => issue.field === 'output')
  })
  return { version: 1, revision: Number.isInteger(value.revision) && (value.revision ?? 0) >= 0 ? value.revision! : 0, rules }
}

export function mergeRules(globalRules: readonly InputRule[], gameRules: readonly InputRule[]): InputRule[] {
  const merged = new Map(globalRules.map((rule) => [rule.id, rule]))
  for (const rule of gameRules) merged.set(rule.id, rule)
  return [...merged.values()]
}

export type RuleBinding = { ruleId: string; field: 'trigger' | 'stop'; chord: InputChord; name: string }

/** Enabled rules' trigger and separate stop chords; `runnableOnly` drops drafts the runtime never starts */
export function ruleBindings(rules: readonly InputRule[], { runnableOnly = false } = {}): RuleBinding[] {
  return rules
    .filter((rule) => rule.enabled && (!runnableOnly || !validateRule(rule).length))
    .flatMap((rule) => {
      const own: RuleBinding[] = [{ ruleId: rule.id, field: 'trigger', chord: rule.trigger, name: rule.name }]
      if (rule.kind === 'macro' && rule.repeat.enabled && rule.stop?.mode === 'separate')
        own.push({ ruleId: rule.id, field: 'stop', chord: rule.stop.binding, name: `${rule.name} 停止键` })
      return own
    })
    .filter((binding) => validChord(binding.chord))
}

export function bindingWarnings(rules: readonly InputRule[], productBindings: readonly ProductBinding[] = []): BindingWarning[] {
  const bindings = ruleBindings(rules)
  const products = productBindings.map((binding) => ({ ...binding, tokens: hotkeyTokens(binding.chord) }))
  const warnings: BindingWarning[] = []
  for (const binding of bindings) {
    const own = new Set(binding.chord.map(atomId))
    for (const other of bindings) {
      if (other === binding) continue
      const theirs = new Set(other.chord.map(atomId))
      if ([...own].every((id) => theirs.has(id)) || [...theirs].every((id) => own.has(id)))
        warnings.push({ ruleId: binding.ruleId, field: binding.field, message: `与“${other.name}”的绑定重叠，可能同时触发` })
    }
    const tokens = inputChordTokens(binding.chord)
    for (const product of products) {
      if (assistFiresOnHotkey(tokens, product.tokens))
        warnings.push({ ruleId: binding.ruleId, field: binding.field, message: `与 Chaya 快捷键“${product.label}”冲突，可能同时触发` })
    }
  }
  return warnings
}
