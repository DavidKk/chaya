import type { InputAssistConfig, InputAtom, InputChord, InputRule, KeyInput, MacroEvent, MacroRule, TurboRule } from '@/lib/game/input-assistance'
import { atomId, chordId, macroSteps, MIN_PRESS_MS, parseInputAssistConfig, randomInterval, spaceMacroEvents, validateRule } from '@/lib/game/input-assistance'

export type AssistStatus = { running: string[]; pending: string[]; counts: Record<string, number>; error?: string; recording: boolean }
export type RecordKind = 'binding' | 'macro'
export type RecordResult = InputChord | MacroEvent[]
type Listener = (status: AssistStatus) => void
type Active = { rule: InputRule; timer: number | null; held: Set<string>; count: number; stopped: boolean; startPoint?: { x: number; y: number } }

const GENERATED = '__chayaInputAssistGenerated'
/** 连发每次点按都会计数，状态广播限频，避免每 30 ms 往网页推一次 */
const TURBO_STATUS_MS = 500
function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable], [role="textbox"], #chaya-game-edit-host, #chaya-game-agent-host')
}

function canvas(): HTMLElement | null {
  const graphics = (window as Window & { Graphics?: { _canvas?: HTMLElement } }).Graphics
  return graphics?._canvas ?? document.querySelector<HTMLElement>('canvas')
}

function inGame(target: EventTarget | null): boolean {
  const element = canvas()
  return target instanceof Node && !!element && (element === target || element.contains(target))
}

function fromKey(event: KeyboardEvent): KeyInput {
  return { kind: 'key', code: event.code || event.key, key: event.key, keyCode: event.keyCode || event.which || 0, location: event.location }
}

function chordMatches(chord: InputChord, pressed: Map<string, InputAtom>): boolean {
  return chord.length > 0 && chord.every((atom) => pressed.has(atomId(atom)))
}

function markGenerated(event: Event): void {
  Object.defineProperty(event, GENERATED, { value: true })
}

function isGenerated(event: Event): boolean {
  return Boolean((event as Event & { [GENERATED]?: boolean })[GENERATED])
}

function emitKey(input: KeyInput, phase: 'down' | 'up'): void {
  const event = new KeyboardEvent(phase === 'down' ? 'keydown' : 'keyup', { key: input.key, code: input.code, location: input.location, bubbles: true, cancelable: true })
  for (const field of ['keyCode', 'which'] as const) Object.defineProperty(event, field, { configurable: true, get: () => input.keyCode })
  markGenerated(event)
  document.dispatchEvent(event)
}

function emitMouse(input: InputAtom, phase: 'down' | 'up', point: { x: number; y: number }): void {
  if (input.kind !== 'mouse') return
  const touchInput = (
    window as Window & { TouchInput?: { _onTrigger?: (x: number, y: number) => void; _onRelease?: (x: number, y: number) => void; _onCancel?: (x: number, y: number) => void } }
  ).TouchInput
  const graphics = (window as Window & { Graphics?: { width?: number; height?: number } }).Graphics
  if (touchInput && graphics?.width && graphics.height) {
    const x = Math.round(point.x * graphics.width)
    const y = Math.round(point.y * graphics.height)
    if (input.button === 0 && touchInput._onTrigger && touchInput._onRelease) {
      if (phase === 'down') touchInput._onTrigger(x, y)
      else touchInput._onRelease(x, y)
      return
    }
    if (input.button === 2 && touchInput._onCancel) {
      if (phase === 'down') touchInput._onCancel(x, y)
      return
    }
    throw new Error(`当前游戏不支持${['左', '中', '右'][input.button]}键模拟输入`)
  }
  if (input.button !== 0) throw new Error(`无法确认当前游戏接收${['左', '中', '右'][input.button]}键模拟输入`)
  const target = canvas()
  if (!target) throw new Error('游戏画布不可用')
  const rect = target.getBoundingClientRect()
  const event = new MouseEvent(phase === 'down' ? 'mousedown' : 'mouseup', {
    button: input.button,
    buttons: phase === 'down' ? 1 << input.button : 0,
    clientX: rect.left + point.x * rect.width,
    clientY: rect.top + point.y * rect.height,
    bubbles: true,
    cancelable: true,
  })
  markGenerated(event)
  target.dispatchEvent(event)
}

export class InputAssistanceRuntime {
  private config: InputAssistConfig = { version: 1, revision: 0, rules: [] }
  private pressed = new Map<string, InputAtom>()
  private outputHolders = new Map<string, Set<string>>()
  private replaced = new Set<string>()
  private active = new Map<string, Active>()
  private pending = new Map<string, { once: boolean; timer: number }>()
  private listeners = new Set<Listener>()
  private pointer: { x: number; y: number } | null = null
  private lastPointer: { x: number; y: number } | null = null
  private recording: { kind: RecordKind; started: number; events: MacroEvent[]; held: Set<string>; chord: InputChord; resolve: (value: RecordResult | null) => void } | null = null
  private error: string | undefined

  constructor() {
    document.addEventListener('keydown', this.onKeyDown, true)
    document.addEventListener('keyup', this.onKeyUp, true)
    document.addEventListener('mousedown', this.onMouseDown, true)
    document.addEventListener('mouseup', this.onMouseUp, true)
    document.addEventListener('pointerdown', this.onPointerDown, true)
    document.addEventListener('pointerup', this.onPointerUp, true)
    document.addEventListener('mousemove', this.onMove, true)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('focus', this.onFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  dispose(): void {
    this.stopAll()
    this.cancelRecording()
    document.removeEventListener('keydown', this.onKeyDown, true)
    document.removeEventListener('keyup', this.onKeyUp, true)
    document.removeEventListener('mousedown', this.onMouseDown, true)
    document.removeEventListener('mouseup', this.onMouseUp, true)
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    document.removeEventListener('pointerup', this.onPointerUp, true)
    document.removeEventListener('mousemove', this.onMove, true)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('focus', this.onFocus)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.listeners.clear()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.status())
    return () => this.listeners.delete(listener)
  }

  status(): AssistStatus {
    return {
      running: [...this.active].filter(([, active]) => active.rule.kind !== 'mapping').map(([id]) => id),
      pending: [...this.pending.keys()],
      counts: Object.fromEntries([...this.active].map(([id, active]) => [id, active.count])),
      error: this.error,
      recording: !!this.recording,
    }
  }

  snapshot(): InputAssistConfig {
    return this.config
  }

  setConfig(raw: unknown): InputAssistConfig {
    const next = parseInputAssistConfig(raw)
    this.stopAll()
    this.config = next
    this.emit()
    return next
  }

  stop(ruleId: string): void {
    const pending = this.pending.get(ruleId)
    if (pending) {
      window.clearTimeout(pending.timer)
      this.pending.delete(ruleId)
      this.emit()
    }
    const active = this.active.get(ruleId)
    if (!active) return
    active.stopped = true
    if (active.timer !== null) window.clearTimeout(active.timer)
    try {
      for (const id of [...active.held]) {
        try {
          this.release(active, id)
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error)
        }
      }
    } finally {
      this.active.delete(ruleId)
      this.emit()
    }
  }

  stopAll(): void {
    for (const id of [...this.pending.keys()]) this.stop(id)
    for (const id of [...this.active.keys()]) this.stop(id)
  }

  start(ruleId: string, once = false): void {
    if ((window as Window & { __chayaAgentInputActive?: number }).__chayaAgentInputActive) throw new Error('Agent 正在操作游戏，请稍后再启动辅助')
    const rule = this.config.rules.find((item) => item.id === ruleId)
    if (!rule) throw new Error('规则不存在')
    if (!once && !rule.enabled) throw new Error('规则尚未启用')
    const issue = validateRule(rule)[0]
    if (issue) throw new Error(issue.message)
    if (document.hidden || !document.hasFocus()) {
      if (!this.pending.has(ruleId)) {
        const timer = window.setTimeout(() => {
          this.pending.delete(ruleId)
          this.error = '等待切回游戏超时，输入未发送'
          this.emit()
        }, 15_000)
        this.pending.set(ruleId, { once, timer })
        this.emit()
      }
      return
    }
    if (this.active.has(rule.id)) return
    const active: Active = { rule, timer: null, held: new Set(), count: 0, stopped: false }
    if (rule.kind === 'macro' ? rule.events.some((event) => event.input.kind === 'mouse') : rule.output.some((input) => input.kind === 'mouse')) {
      if (!this.pointer) throw new Error('请先把鼠标移到游戏画面')
      active.startPoint = { ...this.pointer }
    }
    this.active.set(rule.id, active)
    try {
      if (rule.kind === 'mapping') {
        for (const key of rule.output) this.hold(active, key)
        if (once) active.timer = window.setTimeout(() => this.stop(rule.id), 40)
      } else if (rule.kind === 'turbo') this.turbo(active, once)
      else this.play(active, once)
    } catch (error) {
      this.stop(rule.id)
      throw error
    }
    this.emit()
  }

  record(kind: RecordKind): Promise<RecordResult | null> {
    this.cancelRecording()
    this.stopAll()
    return new Promise((resolve) => {
      this.recording = { kind, started: performance.now(), events: [], held: new Set(), chord: [], resolve }
      this.emit()
    })
  }

  finishRecording(): RecordResult | null {
    const rec = this.recording
    if (!rec) return null
    if (rec.held.size) throw new Error('请先松开所有按键')
    const offset = rec.events[0]?.atMs ?? 0
    const result = rec.kind === 'binding' ? rec.chord : rec.events.map((event) => ({ ...event, atMs: event.atMs - offset }))
    this.recording = null
    rec.resolve(result.length ? result : null)
    this.emit()
    return result.length ? result : null
  }

  cancelRecording(): void {
    const rec = this.recording
    if (!rec) return
    this.recording = null
    rec.resolve(null)
    this.emit()
  }

  /** 已启用但未配置完的规则不参与触发、也不吞原键，配置完成后自动生效 */
  private runnable(rule: InputRule): boolean {
    return rule.enabled && !validateRule(rule).length
  }

  private emit(): void {
    const value = this.status()
    for (const listener of this.listeners) listener(value)
  }

  private pointFrom(event: MouseEvent): { x: number; y: number } | null {
    const target = canvas()
    if (!target) return null
    const rect = target.getBoundingClientRect()
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return null
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  private onMove = (event: MouseEvent): void => {
    this.pointer = this.pointFrom(event)
    if (this.pointer) this.lastPointer = this.pointer
  }

  private onBlur = (): void => {
    this.pressed.clear()
    this.replaced.clear()
    this.stopAll()
    if (this.recording?.held.size) this.cancelRecording()
    else if (this.recording) this.finishRecording()
  }

  private onFocus = (): void => {
    for (const [ruleId, request] of [...this.pending]) {
      window.clearTimeout(request.timer)
      this.pending.delete(ruleId)
      try {
        this.start(ruleId, request.once)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
    }
    this.emit()
  }

  private onVisibility = (): void => {
    if (document.hidden) this.onBlur()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isGenerated(event) || !event.isTrusted || isEditable(event.target)) return
    if (event.repeat) {
      if (this.replaced.has(atomId(fromKey(event)))) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    this.handlePhysical('down', fromKey(event), event)
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (isGenerated(event) || !event.isTrusted) return
    const atom = fromKey(event)
    this.handlePhysical('up', atom, event)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !event.isTrusted || event.button > 2 || !inGame(event.target)) return
    this.pointer = this.pointFrom(event)
    if (this.pointer) this.lastPointer = this.pointer
    this.handlePhysical('down', { kind: 'mouse', button: event.button as 0 | 1 | 2 }, event)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !event.isTrusted || event.button > 2) return
    this.handlePhysical('up', { kind: 'mouse', button: event.button as 0 | 1 | 2 }, event)
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (isGenerated(event) || !event.isTrusted || event.button > 2 || !inGame(event.target)) return
    if (this.recording) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.pressed.has(`mouse:${event.button}`)) {
      if (this.replaced.has(`mouse:${event.button}`)) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    this.pointer = this.pointFrom(event)
    if (this.pointer) this.lastPointer = this.pointer
    this.handlePhysical('down', { kind: 'mouse', button: event.button as 0 | 1 | 2 }, event)
  }

  private onMouseUp = (event: MouseEvent): void => {
    if (isGenerated(event) || !event.isTrusted || event.button > 2) return
    if (this.recording) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!this.pressed.has(`mouse:${event.button}`)) {
      if (this.replaced.delete(`mouse:${event.button}`)) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    this.handlePhysical('up', { kind: 'mouse', button: event.button as 0 | 1 | 2 }, event)
  }

  private handlePhysical(phase: 'down' | 'up', atom: InputAtom, event: Event): void {
    const id = atomId(atom)
    const wasPressed = this.pressed.has(id)
    if (phase === 'down') this.pressed.set(id, atom)
    else this.pressed.delete(id)
    if (this.recording) {
      event.preventDefault()
      event.stopPropagation()
      const rec = this.recording
      if (phase === 'down' && !rec.held.has(id)) {
        rec.held.add(id)
        if (!rec.chord.some((input) => atomId(input) === id)) rec.chord.push(atom)
        if (rec.kind === 'macro') rec.events.push({ atMs: Math.round(performance.now() - rec.started), phase, input: atom })
      } else if (phase === 'up' && rec.held.delete(id) && rec.kind === 'macro') {
        rec.events.push({ atMs: Math.round(performance.now() - rec.started), phase, input: atom })
      }
      if (phase === 'up' && rec.kind === 'binding' && rec.held.size === 0)
        queueMicrotask(() => {
          if (this.recording === rec) this.finishRecording()
        })
      return
    }
    if (phase === 'up') {
      const swallowed = this.replaced.has(id)
      if (swallowed) {
        event.preventDefault()
        event.stopPropagation()
        if (atom.kind === 'key') this.replaced.delete(id)
      }
      for (const active of [...this.active.values()]) {
        if (active.rule.kind === 'mapping' && !chordMatches(active.rule.trigger, this.pressed)) this.stop(active.rule.id)
      }
      if (!swallowed && this.outputHolders.has(id) && atom.kind === 'key') queueMicrotask(() => emitKey(atom, 'down'))
      return
    }
    if (wasPressed) return
    if (this.config.rules.some((rule) => this.runnable(rule) && rule.originalInput === 'replace' && rule.trigger.some((input) => atomId(input) === id))) {
      event.preventDefault()
      event.stopPropagation()
      this.replaced.add(id)
    }
    const candidates = this.config.rules.filter((rule) => this.runnable(rule) && rule.trigger.some((input) => atomId(input) === id) && chordMatches(rule.trigger, this.pressed))
    const maxSize = Math.max(0, ...candidates.map((rule) => rule.trigger.length))
    for (const rule of candidates.filter((item) => item.trigger.length === maxSize)) {
      const active = this.active.get(rule.id)
      if (((rule.kind === 'macro' && rule.repeat.enabled) || rule.kind === 'turbo') && active) this.stop(rule.id)
      else if (!active) {
        try {
          for (const running of [...this.active.values()]) {
            if (running.rule.kind === 'mapping' && running.rule.trigger.length < rule.trigger.length && chordMatches(running.rule.trigger, this.pressed)) this.stop(running.rule.id)
          }
          this.start(rule.id)
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error)
          this.emit()
        }
      }
      if (rule.originalInput === 'replace') {
        event.preventDefault()
        event.stopPropagation()
        this.replaced.add(id)
      }
    }
    for (const rule of this.config.rules) {
      if (rule.kind !== 'macro' || !rule.repeat.enabled || rule.stop?.mode !== 'separate' || !this.active.has(rule.id)) continue
      if (rule.stop.binding.some((input) => atomId(input) === id) && chordMatches(rule.stop.binding, this.pressed) && chordId(rule.stop.binding) !== chordId(rule.trigger)) {
        this.stop(rule.id)
        if (rule.originalInput === 'replace') {
          event.preventDefault()
          event.stopPropagation()
          this.replaced.add(id)
        }
      }
    }
  }

  private hold(active: Active, atom: InputAtom): void {
    const id = atomId(atom)
    if (active.held.has(id)) return
    const holders = this.outputHolders.get(id) ?? new Set<string>()
    const first = holders.size === 0
    holders.add(active.rule.id)
    this.outputHolders.set(id, holders)
    active.held.add(id)
    if (!first) return
    if (atom.kind === 'key') emitKey(atom, 'down')
    else this.mouse(active, atom, 'down')
  }

  private release(active: Active, id: string): void {
    if (!active.held.delete(id)) return
    const holders = this.outputHolders.get(id)
    holders?.delete(active.rule.id)
    if (holders?.size) return
    this.outputHolders.delete(id)
    const atom = active.rule.kind === 'macro' ? active.rule.events.find((item) => atomId(item.input) === id)?.input : active.rule.output.find((item) => atomId(item) === id)
    if (!atom) return
    if (atom.kind === 'key') {
      // 连发的触发键常与输出键相同，物理键仍按着时也要发 keyup，否则游戏读到一直按住
      if (!this.pressed.has(id) || active.rule.kind === 'turbo') emitKey(atom, 'up')
    } else this.mouse(active, atom, 'up')
  }

  private mouse(active: Active, atom: InputAtom, phase: 'down' | 'up'): void {
    const point =
      active.rule.kind === 'macro' && active.rule.mousePosition === 'start'
        ? active.startPoint
        : phase === 'up'
          ? (this.pointer ?? this.lastPointer ?? active.startPoint)
          : this.pointer
    if (!point) throw new Error('鼠标已移出游戏画面')
    if (phase === 'down' && !active.startPoint) active.startPoint = { ...point }
    emitMouse(atom, phase, point)
  }

  private turbo(active: Active, once: boolean): void {
    const rule = active.rule as TurboRule
    const input = rule.output[0]
    let lastEmit = -Infinity
    const fail = (error: unknown) => {
      this.error = error instanceof Error ? error.message : String(error)
      this.stop(rule.id)
    }
    const tap = (): void => {
      if (active.stopped) return
      const interval = randomInterval(rule.interval)
      const press = Math.min(MIN_PRESS_MS, Math.floor(interval / 2))
      try {
        this.hold(active, input)
      } catch (error) {
        fail(error)
        return
      }
      active.timer = window.setTimeout(() => {
        if (active.stopped) return
        try {
          this.release(active, atomId(input))
        } catch (error) {
          fail(error)
          return
        }
        active.count += 1
        const now = performance.now()
        if (now - lastEmit >= TURBO_STATUS_MS) {
          lastEmit = now
          this.emit()
        }
        if (once) this.stop(rule.id)
        else active.timer = window.setTimeout(tap, interval - press)
      }, press)
    }
    tap()
  }

  private play(active: Active, once: boolean): void {
    const rule = active.rule as MacroRule
    const events = spaceMacroEvents(rule.events)
    const start = performance.now()
    const run = (index: number): void => {
      if (active.stopped) return
      if (index >= events.length) {
        active.count += 1
        this.emit()
        if (rule.repeat.enabled && !once) active.timer = window.setTimeout(() => this.play(active, false), rule.repeat.intervalMs)
        else this.stop(rule.id)
        return
      }
      const event = events[index]
      const delay = Math.max(0, event.atMs - (performance.now() - start))
      active.timer = window.setTimeout(
        () => {
          try {
            if (event.phase === 'down') this.hold(active, event.input)
            else this.release(active, atomId(event.input))
            run(index + 1)
          } catch (error) {
            this.error = error instanceof Error ? error.message : String(error)
            this.stop(rule.id)
          }
        },
        Math.max(index === 0 ? 0 : 1, delay)
      )
    }
    run(0)
  }
}

export function recordedSteps(events: MacroEvent[]): number {
  return macroSteps(events).length
}
