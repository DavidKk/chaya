import {
  type CurrentEvent,
  type EventActivity,
  type EventControlAction,
  type EventControlBlock,
  type EventControlTarget,
  readEventRuntime,
  type RuntimeHost,
  type RuntimeInterpreter,
} from '@/lib/game/events/runtime'

import { RunCheats } from '../runtime/cheats-run'

type Interpreter = RuntimeInterpreter & {
  setup: (list: NonNullable<RuntimeInterpreter['_list']>, eventId: number) => void
  terminate: () => void
}
type Host = RuntimeHost & { Game_Interpreter?: { prototype: Interpreter } }
const host = () => globalThis as unknown as Host
const tokens = new WeakMap<RuntimeInterpreter, string>()
let sequence = 0
const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function token(interpreter: RuntimeInterpreter) {
  let value = tokens.get(interpreter)
  if (!value) {
    value = `${epoch}:${++sequence}`
    tokens.set(interpreter, value)
  }
  return value
}

/** A fresh setup invalidates controls from the previous run, even when the list is reused. */
export function installEventControlTracking() {
  const proto = host().Game_Interpreter?.prototype
  if (!proto?.setup) return () => {}
  const original = proto.setup
  const wrapped: Interpreter['setup'] = function (this: Interpreter, list, eventId) {
    tokens.delete(this)
    return original.call(this, list, eventId)
  }
  proto.setup = wrapped
  return () => {
    if (proto.setup === wrapped) proto.setup = original
  }
}

function resolve(path: string): Interpreter | null {
  const root = host()
  const [head, ...children] = path.split('/')
  let value: RuntimeInterpreter | undefined | null
  if (head === 'map') value = root.$gameMap?._interpreter
  else if (head === 'troop') value = root.$gameTroop?._interpreter
  else if (head.startsWith('event:')) value = root.$gameMap?._events?.find((e) => e?._eventId === Number(head.slice(6)))?._interpreter
  else if (head.startsWith('common:')) value = root.$gameMap?._commonEvents?.find((e) => e._commonEventId === Number(head.slice(7)))?._interpreter
  for (const part of children) {
    if (part !== 'child') return null
    value = value?._childInterpreter
  }
  return (value as Interpreter | null) ?? null
}

function messageBusy() {
  const message = host().$gameMessage
  return !!(message?._texts?.length || message?._choices?.length || message?._scrollMode)
}

function blocked(interpreter: RuntimeInterpreter, action: EventControlAction): EventControlBlock {
  if (interpreter._childInterpreter?._list) return 'child'
  if (messageBusy() || interpreter._waitMode === 'message') return 'message'
  const mode = interpreter._waitMode || ''
  if (mode === 'route') {
    const character = interpreter._character as { restoreMoveRoute?: () => void } | undefined
    return character?.restoreMoveRoute && interpreter._list?.[(interpreter._index ?? 0) - 1]?.code === 205 ? null : 'unsupported'
  }
  if (mode) return 'unsupported'
  if ((action === 'skip' || action === 'advance') && typeof (interpreter as Interpreter).terminate !== 'function') return 'unsupported'
  return null
}

export function readEventActivity(): EventActivity {
  const state = readEventRuntime(host(), false)
  const entries: CurrentEvent[] = state.entries.flatMap((entry) => {
    const interpreter = resolve(entry.path)
    if (!interpreter) return []
    return [
      {
        path: entry.path,
        mapId: entry.mapId,
        eventId: entry.eventId,
        commonEventId: entry.commonEventId,
        page: entry.page,
        name: entry.name,
        index: entry.index,
        code: entry.code,
        previousCode: entry.previousCode,
        waitMode: entry.waitMode,
        child: entry.child,
        token: token(interpreter),
        waiting: entry.waitCount > 0,
        skipBlocked: blocked(interpreter, 'skip'),
        restartBlocked: blocked(interpreter, 'restart'),
        advanceBlocked: blocked(interpreter, 'advance'),
      },
    ]
  })
  return {
    entries,
    transparent: !!state.player?.transparent,
    movementLocked: !!state.movementLocks.player,
    faded: !!state.faded,
    candidates: state.candidates ?? [],
  }
}

/** Ends or restarts one unchanged call frame, preserving its caller and unrelated interpreters. */
export function controlCurrentEvent(action: EventControlAction, target: EventControlTarget) {
  if (action !== 'skip' && action !== 'restart' && action !== 'advance') throw new Error('Unsupported event operation')
  const interpreter = resolve(target.path)
  if (
    !interpreter?._list ||
    token(interpreter) !== target.token ||
    interpreter._index !== target.index ||
    (interpreter._waitMode || '') !== target.waitMode ||
    (interpreter._waitCount ?? 0) > 0 !== target.waiting
  ) {
    throw new Error('The event has changed. Select the current event again.')
  }
  const reason = blocked(interpreter, action)
  if (reason) throw new Error(`Event control unavailable: ${reason}`)
  if (interpreter._waitMode === 'route') {
    const character = interpreter._character as { _moveRouteForcing?: boolean; restoreMoveRoute: () => void }
    if (character._moveRouteForcing) {
      character._moveRouteForcing = false
      character.restoreMoveRoute()
    }
  }
  if (interpreter._waitMode === 'message' || messageBusy()) {
    try {
      host().$gameMessage?.clear?.()
    } catch {}
  }
  interpreter._waitMode = ''
  interpreter._waitCount = 0

  if (action === 'restart') {
    interpreter.setup(interpreter._list, interpreter._eventId ?? 0)
    tokens.delete(interpreter)
    return
  }

  if (action === 'advance') {
    const list = interpreter._list
    const startIdx = interpreter._index ?? 0
    const root = host() as any
    for (let i = startIdx; i < list.length; i++) {
      const cmd = list[i]
      if (!cmd || !Array.isArray(cmd.parameters)) continue
      try {
        if (cmd.code === 121 && cmd.parameters.length >= 3) {
          const [start, end, val] = cmd.parameters as [number, number, number]
          const on = val === 0
          const sw = root.$gameSwitches
          if (sw && typeof sw.setValue === 'function') {
            for (let id = start; id <= end; id++) sw.setValue(id, on)
          }
        } else if (cmd.code === 122 && cmd.parameters.length >= 5) {
          const [start, end, op, operandType, operandVal] = cmd.parameters as [number, number, number, number, any]
          const vars = root.$gameVariables
          if (vars && typeof vars.setValue === 'function' && op === 0 && operandType === 0) {
            for (let id = start; id <= end; id++) vars.setValue(id, operandVal)
          }
        } else if (cmd.code === 201 && cmd.parameters.length >= 4) {
          const [, targetMapId, targetX, targetY, direction, fadeType] = cmd.parameters as [number, number, number, number, number, number]
          const player = root.$gamePlayer
          if (player && typeof player.reserveTransfer === 'function') {
            player.reserveTransfer(targetMapId, targetX, targetY, direction ?? 0, fadeType ?? 0)
          }
        } else if (cmd.code === 356 && typeof cmd.parameters[0] === 'string') {
          const str = (cmd.parameters[0] as string).trim()
          const [name, ...args] = str.split(/\s+/)
          if (typeof (interpreter as any).pluginCommand === 'function') {
            try {
              ;(interpreter as any).pluginCommand(name, args)
            } catch {}
          }
        }
      } catch {}
    }
  }

  interpreter.terminate()
  tokens.delete(interpreter)
  try {
    RunCheats.unstuck()
  } catch {}
}
