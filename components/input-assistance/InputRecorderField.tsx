'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { IoCloseOutline } from 'react-icons/io5'
import { LuChevronRight, LuCircleDot } from 'react-icons/lu'

import { hotkeyClearBtn, hotkeyShell } from '@/components/game-edit'
import { Tooltip } from '@/components/sk'
import { controlDisabledShell } from '@/components/sk/control'
import {
  atomId,
  chordLabel,
  type InputAtom,
  type InputChord,
  type KeyInput,
  type MacroEvent,
  macroLabel,
  type MacroStep,
  macroSteps,
  MAX_MACRO_EVENTS,
  MAX_MACRO_STEPS,
  spaceMacroEvents,
} from '@/lib/game/input-assistance'
import { cn } from '@/lib/utils'

import { keySeparator, KeyText } from './KeyText'

const recorderInput = cn(
  'absolute inset-0 z-0 m-0 box-border flex cursor-pointer items-center gap-1 rounded-none border-none bg-transparent py-0 pr-8 pl-2',
  'text-left font-inherit text-[0.8125rem] leading-8 text-ink outline-none disabled:cursor-not-allowed'
)

type Props = {
  label: string
  kind: 'binding' | 'macro'
  value: InputChord | MacroEvent[]
  onChange: (value: InputChord | MacroEvent[]) => void
  accept?: (value: InputChord | MacroEvent[]) => string | null
  error?: string
  warning?: string
  compact?: boolean
  /** binding 模式只保留最后按下的一个键 */
  single?: boolean
  disabled?: boolean
}

const MAX_BINDING_INPUTS = 8

/** 每步一行：从第一键按下起算的按下、弹起时刻（读屏用纯文本） */
function stepTimeline(steps: readonly MacroStep[]): string {
  const origin = steps[0]?.startMs ?? 0
  return steps.map((step) => `${chordLabel(step.inputs)} 按下 ${Math.round(step.startMs - origin)} ms，弹起 ${Math.round(step.endMs - origin)} ms`).join('；')
}

/** 对齐的时间表：按键 | 时间轴条 | 按下 | 弹起；时间从第一键按下起算 */
function MacroTimeline({ steps, warning }: { steps: readonly MacroStep[]; warning?: string }) {
  const origin = steps[0].startMs
  const total = Math.max(1, ...steps.map((step) => step.endMs - origin))
  return (
    <div className="whitespace-normal">
      <div className="grid grid-cols-[auto_5rem_auto_auto] items-center gap-x-3 gap-y-1 tabular-nums">
        <span className="font-normal text-ink-soft">按键</span>
        <span className="font-normal text-ink-soft">时间轴</span>
        <span className="text-right font-normal text-ink-soft">按下</span>
        <span className="text-right font-normal text-ink-soft">弹起</span>
        {steps.map((step, index) => {
          const start = step.startMs - origin
          const end = step.endMs - origin
          return (
            <Fragment key={index}>
              <span>
                <KeyText text={chordLabel(step.inputs)} />
              </span>
              <span className="relative h-1.5 rounded-full bg-[rgb(230_238_248/0.08)]">
                <span
                  className="absolute inset-y-0 rounded-full bg-accent"
                  style={{ left: `${(start / total) * 100}%`, width: `${Math.max(4, ((end - start) / total) * 100)}%` }}
                />
              </span>
              <span className="text-right">{Math.round(start)}</span>
              <span className="text-right">{Math.round(end)}</span>
            </Fragment>
          )
        })}
      </div>
      <p className="mt-1.5 font-normal text-ink-soft">单位 ms，从第一个键按下开始计时</p>
      {warning ? <p className="mt-1 text-warn">{warning}</p> : null}
    </div>
  )
}

type Recording = { started: number; held: Map<string, InputAtom>; chord: InputChord; events: MacroEvent[] }
let activeRecorder: { token: symbol; cancel: () => void } | null = null

function fromKey(event: KeyboardEvent): KeyInput {
  return { kind: 'key', code: event.code || event.key, key: event.key, keyCode: event.keyCode || event.which || 0, location: event.location }
}

export function InputRecorderField({ label, kind, value, onChange, accept, error, warning, compact = false, single = false, disabled = false }: Props) {
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [preview, setPreview] = useState<InputChord>([])
  const [previewEvents, setPreviewEvents] = useState<MacroEvent[]>([])
  const current = useRef<Recording | null>(null)
  const token = useRef(Symbol('input-recorder'))
  const isMacro = kind === 'macro'
  const events = isMacro ? (value as MacroEvent[]) : []
  const summary = isMacro ? macroLabel(events) : chordLabel(value as InputChord)
  const steps = isMacro ? macroSteps(events) : []
  const shownSteps = recording ? macroSteps(spaceMacroEvents(previewEvents)) : steps
  const shown = recording ? (isMacro ? '' : chordLabel(preview)) : summary
  const detail = isMacro ? stepTimeline(steps) : summary

  function cancel() {
    current.current = null
    setRecording(false)
    if (activeRecorder?.token === token.current) activeRecorder = null
  }

  useEffect(
    () => () => {
      if (activeRecorder?.token === token.current) activeRecorder = null
    },
    []
  )

  function finish() {
    const state = current.current
    if (!state) return
    if (state.held.size) {
      setRecordError('请先松开按键再结束录制')
      return
    }
    const result = isMacro ? spaceMacroEvents(state.events.map((event) => ({ ...event, atMs: event.atMs - (state.events[0]?.atMs ?? 0) }))) : state.chord
    if (result.length) {
      const issue = accept?.(result)
      if (issue) {
        setRecordError(issue)
        return
      }
      onChange(result)
    }
    cancel()
  }

  function start() {
    if (recording || (activeRecorder && activeRecorder.token !== token.current)) return
    activeRecorder = { token: token.current, cancel }
    current.current = { started: performance.now(), held: new Map(), chord: [], events: [] }
    setRecordError('')
    setPreview([])
    setPreviewEvents([])
    setRecording(true)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  useEffect(() => {
    if (!recording) return

    function capture(event: KeyboardEvent | MouseEvent, phase: 'down' | 'up') {
      const state = current.current
      if (!state) return
      if (event.target instanceof Element && event.target.closest('[data-assist-record-control]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event instanceof KeyboardEvent && event.repeat) return
      if (event instanceof MouseEvent && event.button > 2) return
      const input: InputAtom = event instanceof KeyboardEvent ? fromKey(event) : { kind: 'mouse', button: event.button as 0 | 1 | 2 }
      const id = atomId(input)
      if (phase === 'down') {
        if (state.held.has(id)) return
        if (isMacro && (state.events.length >= MAX_MACRO_EVENTS - 1 || macroSteps(spaceMacroEvents(state.events)).length >= MAX_MACRO_STEPS)) {
          setRecordError('已达到录制上限，点击录制图标完成')
          return
        }
        if (single) {
          state.chord = [input]
          setPreview([input])
        } else if (!isMacro && !state.chord.some((item) => atomId(item) === id)) {
          if (state.chord.length >= MAX_BINDING_INPUTS) {
            setRecordError(`最多 ${MAX_BINDING_INPUTS} 个按键，点击录制图标完成`)
            return
          }
          state.chord.push(input)
          setPreview([...state.chord])
        }
        state.held.set(id, input)
      } else {
        if (!state.held.has(id)) return
        state.held.delete(id)
      }
      if (isMacro) {
        state.events.push({ atMs: Math.min(60_000, Math.round(performance.now() - state.started)), phase, input })
        setPreviewEvents([...state.events])
      }
    }

    const down = (event: KeyboardEvent) => capture(event, 'down')
    const up = (event: KeyboardEvent) => capture(event, 'up')
    const mouseDown = (event: MouseEvent) => capture(event, 'down')
    const mouseUp = (event: MouseEvent) => capture(event, 'up')
    const contextMenu = (event: MouseEvent) => event.preventDefault()
    const blur = () => {
      const state = current.current
      if (!state) return
      const atMs = Math.min(60_000, Math.round(performance.now() - state.started))
      if (isMacro) {
        for (const input of state.held.values()) state.events.push({ atMs, phase: 'up', input })
        setPreviewEvents([...state.events])
      }
      state.held.clear()
    }
    document.addEventListener('keydown', down, true)
    document.addEventListener('keyup', up, true)
    document.addEventListener('mousedown', mouseDown, true)
    document.addEventListener('mouseup', mouseUp, true)
    document.addEventListener('contextmenu', contextMenu, true)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('keydown', down, true)
      document.removeEventListener('keyup', up, true)
      document.removeEventListener('mousedown', mouseDown, true)
      document.removeEventListener('mouseup', mouseUp, true)
      document.removeEventListener('contextmenu', contextMenu, true)
      window.removeEventListener('blur', blur)
    }
  }, [recording, isMacro, single])

  return (
    <div className="grid gap-1">
      {!compact ? <span className="text-xs font-medium text-ink">{label}</span> : null}
      <Tooltip
        content={
          recording ? (
            isMacro ? (
              '在页面任意处输入动作；点击右侧录制图标完成'
            ) : single ? (
              '按下一个键或鼠标键，再按其它键可替换；点击右侧录制图标完成'
            ) : (
              '依次按下要输出的键或鼠标键，可多个；点击右侧录制图标完成'
            )
          ) : isMacro && steps.length ? (
            <MacroTimeline steps={steps} warning={compact ? warning : undefined} />
          ) : (
            [detail || '点击录制', compact ? warning : ''].filter(Boolean).join('\n')
          )
        }
        triggerClassName="block w-full min-w-0"
      >
        <span
          className={cn(hotkeyShell, 'w-full', recording ? 'border-accent' : error ? 'border-fail' : warning ? 'border-warn' : '', disabled && !recording && controlDisabledShell)}
          data-recording={recording || undefined}
        >
          <button
            type="button"
            data-assist-record-control
            className={recorderInput}
            disabled={disabled && !recording}
            aria-label={recording ? `正在录制${label}` : `${label}：${detail || '尚未录制'}，点击录制`}
            aria-pressed={recording}
            onClick={start}
          >
            <span className={cn('min-w-0 truncate', !shown && 'text-ink-soft')}>
              {isMacro && shownSteps.length ? (
                shownSteps.map((step, index) => (
                  <span key={index}>
                    {index ? <LuChevronRight size={11} className={keySeparator} aria-hidden /> : null}
                    <KeyText text={chordLabel(step.inputs)} />
                  </span>
                ))
              ) : shown ? (
                <KeyText text={shown} />
              ) : recording ? (
                '正在录制…'
              ) : (
                '—'
              )}
            </span>
          </button>
          {recording ? (
            <button type="button" data-assist-record-control className={cn(hotkeyClearBtn, 'text-fail hover:text-fail')} aria-label={`完成${label}录制`} onClick={finish}>
              <LuCircleDot size={15} className="animate-pulse" aria-hidden />
            </button>
          ) : summary ? (
            <button type="button" className={hotkeyClearBtn} aria-label={`清除${label}`} disabled={disabled} onClick={() => onChange([])}>
              <IoCloseOutline size={15} aria-hidden />
            </button>
          ) : null}
        </span>
      </Tooltip>
      {error ? (
        <p role="alert" className="text-xs text-fail">
          {error}
        </p>
      ) : null}
      {recordError ? (
        <p role="alert" className="text-xs text-fail">
          {recordError}
        </p>
      ) : null}
      {warning && !compact ? <p className="text-xs text-warn">{warning}</p> : null}
    </div>
  )
}
