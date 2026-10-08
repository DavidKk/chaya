import { analyzeExecutionSafety, normalizeCommands } from '@/lib/game/events'
import type { MapOperationItem, MapOperationMessage, MapOperationValue } from '@/lib/runtime/game-link-protocol'

import { isOnMapScene, loadedMapEntries, runCommonEventOnMap } from '../live-events'
import { playerSpot, runMapEvent, setSelfSwitch, teleportPlayer, transferPending } from '../live-map'
import { MapOperationCoordinator, type UndoAdapter, type UndoValue } from './coordinator'

type Send = (message: MapOperationMessage) => void

const coordinator = new MapOperationCoordinator()

function keyOf(change: MapOperationValue): string {
  if (change.kind === 'switch') return `switch:${Math.floor(change.id)}`
  if (change.kind === 'variable') return `variable:${Math.floor(change.id)}`
  if (change.kind === 'selfSwitch') return `selfSwitch:${Math.floor(change.mapId)}:${Math.floor(change.eventId)}:${change.letter}`
  return 'playerPosition'
}

function parseKey(
  key: string
):
  { kind: 'switch'; id: number } | { kind: 'variable'; id: number } | { kind: 'selfSwitch'; mapId: number; eventId: number; letter: 'A' | 'B' | 'C' | 'D' } | { kind: 'position' } {
  const parts = key.split(':')
  if ((parts[0] === 'switch' || parts[0] === 'variable') && Number(parts[1]) > 0) return { kind: parts[0], id: Math.floor(Number(parts[1])) }
  if (parts[0] === 'selfSwitch' && Number(parts[1]) > 0 && Number(parts[2]) > 0 && ['A', 'B', 'C', 'D'].includes(parts[3])) {
    return { kind: 'selfSwitch', mapId: Math.floor(Number(parts[1])), eventId: Math.floor(Number(parts[2])), letter: parts[3] as 'A' | 'B' | 'C' | 'D' }
  }
  if (key === 'playerPosition') return { kind: 'position' }
  throw new Error(`未知地图操作项：${key}`)
}

function selfSwitchValue(mapId: number, eventId: number, letter: string): boolean {
  const data = (globalThis as { $gameSelfSwitches?: { value?: (key: unknown[]) => unknown; _data?: Record<string, boolean> } }).$gameSelfSwitches
  if (!data) throw new Error('请先读档进游戏')
  return typeof data.value === 'function' ? !!data.value([mapId, eventId, letter]) : !!data._data?.[`${mapId},${eventId},${letter}`]
}

const adapter: UndoAdapter = {
  read(key) {
    const target = parseKey(key)
    if (target.kind === 'switch') return !!$gameSwitches?.value(target.id)
    if (target.kind === 'variable') return Number($gameVariables?.value(target.id) ?? 0)
    if (target.kind === 'position') return playerSpot()
    return selfSwitchValue(target.mapId, target.eventId, target.letter)
  },
  write(key, value) {
    const target = parseKey(key)
    if (target.kind === 'switch') {
      if (!$gameSwitches) throw new Error('请先读档进游戏')
      $gameSwitches.setValue(target.id, !!value)
    } else if (target.kind === 'variable') {
      if (!$gameVariables) throw new Error('请先读档进游戏')
      $gameVariables.setValue(target.id, Math.floor(Number(value) || 0))
    } else if (target.kind === 'selfSwitch') setSelfSwitch(target.mapId, target.eventId, target.letter, !!value)
    else {
      const spot = value as { mapId?: number; x?: number; y?: number; direction?: number }
      if (transferPending()) throw new Error('传送中，无法还原玩家位置')
      const message = (globalThis as { $gameMessage?: { isBusy?: () => boolean } }).$gameMessage
      if (message?.isBusy?.()) throw new Error('对话进行中，已还原触发条件；玩家位置可稍后重试')
      return teleportPlayer({ mapId: Number(spot.mapId), x: Number(spot.x), y: Number(spot.y), direction: Number(spot.direction) || 2 }).then(() => undefined)
    }
  },
}

function assertSafeMoment() {
  if (!isOnMapScene()) throw new Error('请回到地图后再试')
  if (transferPending()) throw new Error('传送中，请稍后再试')
  const message = (globalThis as { $gameMessage?: { isBusy?: () => boolean } }).$gameMessage
  if (message?.isBusy?.()) throw new Error('对话进行中，请结束对话后再试')
}

type RawPage = { conditions?: Record<string, unknown>; trigger?: number; list?: unknown }
type RawEvent = { pages?: RawPage[] }

function unsafeAutomatic(change: MapOperationValue, before: unknown): { message?: string; startsAutomatic: boolean } {
  if (change.kind === 'position') return { startsAutomatic: false }
  if ((change.kind === 'switch' || change.kind === 'selfSwitch') && !change.value) return { startsAutomatic: false }
  if ((change.kind === 'switch' || change.kind === 'selfSwitch') && before === true) return { startsAutomatic: false }
  const candidates: Array<{ mapId: number; list: unknown }> = []
  const commonEvents = (globalThis as { $dataCommonEvents?: unknown[] }).$dataCommonEvents ?? []
  if (change.kind === 'switch' && change.value) {
    for (const event of commonEvents as Array<{ trigger?: number; switchId?: number; list?: unknown } | null>) {
      if (event?.trigger === 1 && event.switchId === change.id) candidates.push({ mapId: playerSpot().mapId, list: event.list })
    }
  }
  for (const { id: mapId, data } of loadedMapEntries()) {
    const events = (data as { events?: Array<RawEvent | null> } | null)?.events ?? []
    for (let eventId = 1; eventId < events.length; eventId++) {
      if (change.kind === 'selfSwitch' && (mapId !== change.mapId || eventId !== change.eventId)) continue
      for (const page of events[eventId]?.pages ?? []) {
        if (page.trigger !== 3) continue
        const conditions = page.conditions ?? {}
        const matches =
          change.kind === 'switch'
            ? change.value &&
              ((conditions.switch1Valid === true && Number(conditions.switch1Id) === change.id) || (conditions.switch2Valid === true && Number(conditions.switch2Id) === change.id))
            : change.kind === 'variable'
              ? conditions.variableValid === true &&
                Number(conditions.variableId) === change.id &&
                Number(before) < Number(conditions.variableValue) &&
                change.value >= Number(conditions.variableValue)
              : conditions.selfSwitchValid === true && String(conditions.selfSwitchCh) === change.letter
        if (matches) candidates.push({ mapId, list: page.list })
      }
    }
  }
  for (const candidate of candidates) {
    const safety = analyzeExecutionSafety(normalizeCommands(candidate.list), (target) => {
      const called = commonEvents[target] as { list?: unknown } | null | undefined
      return called ? normalizeCommands(called.list) : null
    })
    if (!safety.safe) return { message: safety.message, startsAutomatic: false }
  }
  return { startsAutomatic: candidates.some((candidate) => candidate.mapId === playerSpot().mapId) }
}

async function start(message: Extract<MapOperationMessage, { type: 'map.operation.start' }>) {
  assertSafeMoment()
  const undo: UndoValue[] = []
  const status = await coordinator.run(
    message,
    message.items.length === 1 ? 'single' : 'batch',
    message.items,
    async (item) => {
      try {
        assertSafeMoment()
        if ('action' in item) {
          if (item.action.kind === 'commonEvent') runCommonEventOnMap(item.action.id, item.action.from)
          else runMapEvent(item.action)
          return { state: 'completed', value: null }
        }
        const prepared = await Promise.all(
          item.changes.map(async (change) => {
            const key = keyOf(change)
            const before = await adapter.read(key)
            const automatic = unsafeAutomatic(change, before)
            if (automatic.message) throw new Error(automatic.message)
            const value = change.kind === 'position' ? { mapId: change.mapId, x: change.x, y: change.y, direction: change.direction } : change.value
            return { change, key, before, value, startsAutomatic: automatic.startsAutomatic }
          })
        )
        let startsAutomatic = false
        for (const entry of prepared) {
          if (sameOperationValue(entry.before, entry.value)) continue
          await adapter.write(entry.key, entry.change.kind === 'position' ? entry.change : entry.value)
          const after = await adapter.read(entry.key)
          if (!sameOperationValue(after, entry.value)) throw new Error(`写入后校验失败：${entry.key}`)
          undo.push({ key: entry.key, before: entry.before, after })
          startsAutomatic ||= entry.startsAutomatic
        }
        return { state: 'completed', value: null, startedAutomatic: startsAutomatic }
      } catch (error) {
        return { state: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
    },
    (item) => item.label
  )
  if (undo.length) coordinator.recordUndo({ id: message.requestId, summary: message.summary.slice(0, 200), values: undo })
  return { status, undo: coordinator.latestUndo() }
}

export function latestMapUndo() {
  return coordinator.latestUndo()
}

export function runLocalMapChanges(input: { requestId: string; gameId: string; summary: string; items: MapOperationItem[] }) {
  return start({ type: 'map.operation.start', generation: 0, deadlineAt: Date.now() + 60_000, ...input })
}

export function undoLocalMapChange(input: { requestId: string; gameId: string; stepId?: string; force?: boolean }) {
  if (!isOnMapScene()) return Promise.reject(new Error('请回到地图后再试'))
  return coordinator.undo({ requestId: input.requestId, gameId: input.gameId, generation: 0, deadlineAt: Date.now() + 60_000 }, adapter, {
    stepId: input.stepId,
    force: input.force,
  })
}

export function handleMapOperationMessage(message: MapOperationMessage, send: Send): boolean {
  if (!message.type.startsWith('map.operation.') || message.type === 'map.operation.reply') return false
  const requestId = message.requestId
  void (async () => {
    if (message.type === 'map.operation.start') return start(message)
    if (message.type === 'map.operation.undo') {
      // Trigger-state undo deliberately skips the normal dialogue check so an autorun loop can be disarmed.
      if (!isOnMapScene()) throw new Error('请回到地图后再试')
      return coordinator.undo(message, adapter, { stepId: message.stepId, force: message.force })
    }
    if (message.type === 'map.operation.discard-undo') {
      coordinator.discardUndo(message.stepId)
      return { status: coordinator.status(), undo: coordinator.latestUndo() }
    }
    return { status: coordinator.status(message.operationId), undo: coordinator.latestUndo() }
  })().then(
    (result) => send({ type: 'map.operation.reply', requestId, ok: true, ...result }),
    (error) => send({ type: 'map.operation.reply', requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
  )
  return true
}

export function resetMapOperationRuntime() {
  // The coordinator is process-local by design. A game reload creates a fresh module instance.
}

function sameOperationValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
