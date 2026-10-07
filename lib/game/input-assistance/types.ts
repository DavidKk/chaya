export type KeyInput = {
  kind: 'key'
  code: string
  key: string
  keyCode: number
  location?: number
}

export type MouseInput = { kind: 'mouse'; button: 0 | 1 | 2 }
export type InputAtom = KeyInput | MouseInput
export type InputChord = InputAtom[]

export type BaseInputRule = {
  id: string
  name: string
  enabled: boolean
  trigger: InputChord
  originalInput: 'replace' | 'keep'
}

export type MappingRule = BaseInputRule & {
  kind: 'mapping'
  output: InputChord
}

export type MacroEvent = { atMs: number; phase: 'down' | 'up'; input: InputAtom }
export type MacroRule = BaseInputRule & {
  kind: 'macro'
  events: MacroEvent[]
  repeat: { enabled: boolean; intervalMs: number }
  stop?: { mode: 'same-trigger' } | { mode: 'separate'; binding: InputChord }
  mousePosition: 'current' | 'start'
}

/** 连发：按一次快捷键开始重复点按单个键，再按一次停止；每次间隔在 [minMs, maxMs] 内随机 */
export type TurboRule = BaseInputRule & {
  kind: 'turbo'
  output: InputChord
  interval: { minMs: number; maxMs: number }
}

export type InputRule = MappingRule | MacroRule | TurboRule
export type RuleGroup = 'action' | 'mapping' | 'turbo'
export type InputAssistConfig = { version: 1; revision: number; rules: InputRule[] }

export type RuleIssue = { field: 'trigger' | 'output' | 'stop' | 'repeat' | 'interval'; message: string }
export type BindingWarning = { ruleId: string; field: 'trigger' | 'stop'; message: string }

export const EMPTY_INPUT_ASSIST_CONFIG: InputAssistConfig = { version: 1, revision: 0, rules: [] }
export const MAX_INPUT_RULES = 100
export const MAX_MACRO_STEPS = 20
export const MAX_MACRO_EVENTS = 80
export const MIN_REPEAT_MS = 30
export const MAX_REPEAT_MS = 2000
