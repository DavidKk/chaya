/**
 * ChayaAgent command handlers — read RPG Maker state, run declared plugin tools and edit-page commands, press keys.
 * No arbitrary plugin method calls: agents only reach preset abilities (see docs/capabilities.md).
 */

import type { AgentCommand, AgentInputEffect, AgentInputGuard, AgentInputKey, AgentInputStep, AgentParams } from '@/lib/runtime/agent-protocol'
import { parseEditAction, parseEditOp } from '@/lib/runtime/edit-ops'
import { isFirstPartyToolPlugin } from '@/lib/runtime/plugin-tools'

import { findPluginTool, listPluginToolMetas } from '../helpers/plugin-tools'
import { movePlayer, quitGame, snapScreen, tapScreen } from './game-control'
import { battleProgress, readHistory } from './history'

type Loose = Record<string, unknown>
type AnyFn = (...args: unknown[]) => unknown

const DEFAULT_PRESS_FRAMES = 6
const DEFAULT_WAIT_FRAMES = 6
const MAX_PRESS_FRAMES = 600
const MAX_SEQUENCE_STEPS = 64
let manualInputEpoch = 0

export function startManualInputTracking(): () => void {
  const onInput = (event: Event) => {
    if (!event.isTrusted) return
    const target = event.target as Element | null
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
    if (event.type === 'pointerdown' && target?.tagName !== 'CANVAS') return
    if (event.composedPath().some((node) => node instanceof Element && node.id === 'chaya-game-agent-host')) return
    manualInputEpoch += 1
  }
  document.addEventListener('keydown', onInput, true)
  document.addEventListener('pointerdown', onInput, true)
  return () => {
    document.removeEventListener('keydown', onInput, true)
    document.removeEventListener('pointerdown', onInput, true)
  }
}

const DOM_KEYS: Record<AgentInputKey, { key: string; code: string; keyCode: number }> = {
  ok: { key: 'Enter', code: 'Enter', keyCode: 13 },
  cancel: { key: 'Escape', code: 'Escape', keyCode: 27 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  menu: { key: 'x', code: 'KeyX', keyCode: 88 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
}

function g(): Loose {
  return globalThis as unknown as Loose
}

/** Call `obj[name]()` if it exists; swallow errors (state reads must not throw). */
function read<T = unknown>(obj: unknown, name: string, ...args: unknown[]): T | undefined {
  try {
    const fn = (obj as Loose | null | undefined)?.[name]
    return typeof fn === 'function' ? ((fn as AnyFn).apply(obj, args) as T) : undefined
  } catch {
    return undefined
  }
}

/** JSON-safe copy: drops functions, breaks cycles, caps depth / size. */
export function toJsonSafe(value: unknown, depth = 4, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function') return `[Function ${(value as AnyFn).name || 'anonymous'}]`
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  if (depth <= 0) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]'
  seen.add(value)
  if (Array.isArray(value)) {
    const out = value.slice(0, 200).map((v) => toJsonSafe(v, depth - 1, seen))
    if (value.length > 200) out.push(`…${value.length - 200} more`)
    return out
  }
  const out: Loose = {}
  const keys = Object.keys(value)
  for (const key of keys.slice(0, 80)) {
    const v = (value as Loose)[key]
    if (typeof v === 'function') continue
    out[key] = toJsonSafe(v, depth - 1, seen)
  }
  if (keys.length > 80) out['…'] = `${keys.length - 80} more keys`
  return out
}

function gameState() {
  const w = g()
  const scene = (w.SceneManager as Loose | undefined)?._scene as Loose | undefined
  const map = w.$gameMap
  const player = w.$gamePlayer as Loose | undefined
  const party = w.$gameParty
  const message = w.$gameMessage
  const mapId = read<number>(map, 'mapId')
  const mapInfos = w.$dataMapInfos as Array<{ name?: string } | null> | undefined
  const members = read<Loose[]>(party, 'members') ?? []
  const enemies = read<Loose[]>(w.$gameTroop, 'members') ?? []
  const items = (kind: 'items' | 'weapons' | 'armors') =>
    (read<Loose[]>(party, kind) ?? []).slice(0, 100).map((item) => ({ id: item.id ?? null, name: item.name ?? null, count: read(party, 'numItems', item) ?? null }))
  const events = (read<Loose[]>(map, 'events') ?? [])
    .filter((event) => !event._erased)
    .map((event) => {
      const x = Number(event._x)
      const y = Number(event._y)
      const px = Number(player?._x)
      const py = Number(player?._y)
      return {
        id: read(event, 'eventId') ?? event._eventId ?? null,
        name: (read<Loose>(event, 'event')?.name as string | undefined) ?? null,
        x: Number.isFinite(x) ? x : null,
        y: Number.isFinite(y) ? y : null,
        distance: Number.isFinite(x + y + px + py) ? Math.abs(x - px) + Math.abs(y - py) : null,
        running: Boolean(read(event, 'isStarting')),
      }
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .slice(0, 50)
  const windows = scene
    ? Object.entries(scene)
        .filter(([name, value]) => name.endsWith('Window') && value && typeof value === 'object')
        .map(([name, value]) => {
          const win = value as Loose
          const visible = win.visible !== false && Number(win.openness ?? 255) > 0
          if (!visible) return null
          return {
            name: name.replace(/^_/, ''),
            active: Boolean(win.active),
            index: read(win, 'index') ?? win._index ?? null,
            symbol: read(win, 'currentSymbol') ?? null,
            item: toJsonSafe(read(win, 'item'), 2),
          }
        })
        .filter(Boolean)
        .slice(0, 30)
    : []
  const screenText =
    typeof document === 'undefined'
      ? null
      : String(document.body?.innerText || document.body?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000) || null
  const progress = battleProgress()
  const battleManager = w.BattleManager as Loose | undefined
  const acting = read<Loose>(battleManager, 'actor')
  const selectedAction = read<Loose>(battleManager, 'inputtingAction')
  const skills = (read<Loose[]>(acting, 'skills') ?? []).slice(0, 50).map((skill) => ({
    id: skill.id ?? null,
    name: skill.name ?? null,
    usable: read<boolean>(acting, 'canUse', skill) ?? null,
    mpCost: read<number>(acting, 'skillMpCost', skill) ?? skill.mpCost ?? null,
    tpCost: read<number>(acting, 'skillTpCost', skill) ?? skill.tpCost ?? null,
  }))
  const state = {
    scene: (scene?.constructor as { name?: string } | undefined)?.name ?? null,
    title: (w.$dataSystem as { gameTitle?: string } | undefined)?.gameTitle ?? document.title,
    map: mapId ? { id: mapId, name: mapInfos?.[mapId]?.name ?? null, displayName: read(map, 'displayName') || null } : null,
    player: player ? { x: player._x ?? null, y: player._y ?? null, direction: read(player, 'direction') ?? null } : null,
    gold: read(party, 'gold') ?? null,
    party: members.map((a) => ({
      id: read(a, 'actorId'),
      name: read(a, 'name'),
      level: a._level ?? null,
      hp: a._hp ?? null,
      mhp: read(a, 'param', 0) ?? null,
      mp: a._mp ?? null,
      mmp: read(a, 'param', 1) ?? null,
    })),
    playtime: read(w.$gameSystem, 'playtimeText') ?? null,
    inventory: party ? { items: items('items'), weapons: items('weapons'), armors: items('armors') } : null,
    nearbyEvents: events,
    battle:
      (scene?.constructor as { name?: string } | undefined)?.name === 'Scene_Battle'
        ? {
            instanceId: progress.activeBattleId,
            turn: battleManager?._turnCount ?? null,
            phase: battleManager?._phase ?? null,
            actor: acting
              ? { id: read(acting, 'actorId') ?? null, name: read(acting, 'name') ?? null, hp: acting._hp ?? null, mp: acting._mp ?? null, tp: acting._tp ?? null, skills }
              : null,
            selectedAction: selectedAction
              ? {
                  attack: read<boolean>(selectedAction, 'isAttack') ?? null,
                  guard: read<boolean>(selectedAction, 'isGuard') ?? null,
                  skill: read<boolean>(selectedAction, 'isSkill') ?? null,
                  item: read<boolean>(selectedAction, 'isItem') ?? null,
                }
              : null,
            enemies: enemies.map((enemy, index) => ({
              index,
              name: read(enemy, 'name') ?? null,
              hp: enemy._hp ?? null,
              mhp: read(enemy, 'param', 0) ?? null,
              states: (read<Loose[]>(enemy, 'states') ?? []).map((state) => state.name).filter(Boolean),
            })),
          }
        : null,
    lastBattleResult: progress.lastBattleResult,
    manualInputEpoch,
    windows,
    screenText,
    message: message
      ? {
          busy: Boolean(read(message, 'isBusy')),
          speaker: read(message, 'speakerName') || null,
          text: read<string>(message, 'allText') || null,
          choices: read<boolean>(message, 'isChoice') ? (read<string[]>(message, 'choices') ?? []) : null,
        }
      : null,
  }
  const control = JSON.stringify({
    scene: state.scene,
    map: state.map?.id,
    player: state.player,
    party: state.party.map((member) => [member.id, member.hp, member.mp]),
    battle: state.battle,
    windows: state.windows,
    message: state.message,
    manualInputEpoch,
  })
  let hash = 2166136261
  for (let i = 0; i < control.length; i += 1) hash = Math.imul(hash ^ control.charCodeAt(i), 16777619)
  return { ...state, controlToken: (hash >>> 0).toString(36) }
}

function inputEffect(key: AgentInputKey, state: ReturnType<typeof gameState>): AgentInputEffect {
  if (key !== 'ok') return 'navigate'
  const active = state.windows.find((window) => window?.active)
  const name = String(active?.name || '').toLowerCase()
  if (name.includes('choice') || state.message?.choices?.length) return 'choose_branch'
  if (name.includes('save') || name.includes('load')) return 'save_load'
  if (name.includes('item') || name.includes('skill')) return 'spend_resource'
  if (state.message?.busy && !state.message.choices?.length) return 'advance_dialogue'
  if (state.scene === 'Scene_Battle') {
    if (active?.symbol === 'attack' || active?.symbol === 'guard' || active?.symbol === 'fight') return 'battle_command'
    if (active?.symbol === 'skill' || active?.symbol === 'item') return 'navigate'
    if (name.includes('enemy') || name.includes('actor')) {
      const action = read(g().BattleManager, 'inputtingAction') ?? (g().BattleManager as Loose | undefined)?._inputtingAction
      return read<boolean>(action, 'isAttack') ? 'battle_command' : 'unknown'
    }
    return 'unknown'
  }
  return 'unknown'
}

function checkInputGuard(key: AgentInputKey, guard: AgentInputGuard) {
  const state = gameState()
  if (state.controlToken !== guard.controlToken) throw new Error('STATE_CHANGED')
  if (guard.battleInstanceId && state.battle?.instanceId !== guard.battleInstanceId) throw new Error('SCOPE_CHANGED')
  if (guard.mapId != null && state.map?.id !== guard.mapId) throw new Error('SCOPE_CHANGED')
  const effect = inputEffect(key, state)
  if (!Array.isArray(guard.allowedEffects) || !guard.allowedEffects.includes(effect)) throw new Error(`ACTION_REQUIRES_CONFIRMATION:${effect}`)
}

function listPlugins(): unknown {
  const w = g()
  const tools = listPluginToolMetas()
  return Object.keys(w)
    .filter((key) => isFirstPartyToolPlugin(key) && w[key] && typeof w[key] === 'object')
    .sort()
    .map((key) => {
      const declared = tools.filter((tool) => tool.plugin === key).map(({ plugin: _plugin, ...meta }) => meta)
      return { name: key, tools: declared }
    })
}

async function callPluginTool({ plugin, tool, input = {} }: AgentParams<'plugin.tool'>): Promise<unknown> {
  const run = findPluginTool(plugin, tool)
  if (!run) throw new Error(`插件工具不存在：${plugin}.${tool}`)
  const result = await run(input && typeof input === 'object' && !Array.isArray(input) ? input : {})
  return result === undefined ? null : toJsonSafe(result)
}

type AgentEditApi = {
  state: () => unknown
  apply: (op: AgentParams<'edit.apply'>['op']) => unknown
  action: (action: AgentParams<'edit.action'>['action']) => unknown
}

function agentEdit(): AgentEditApi {
  const api = (g().ChayaEdit as { agentEdit?: AgentEditApi } | undefined)?.agentEdit
  if (!api) throw new Error('修改插件未就绪：请确认已安装并加载 ChayaEdit')
  return api
}

function editCatalog(): unknown {
  const catalog = (g().ChayaEdit as { catalog?: () => unknown } | undefined)?.catalog
  if (typeof catalog !== 'function') throw new Error('修改插件未就绪：请确认已安装并加载 ChayaEdit')
  // Plain data from buildLiveCatalog; toJsonSafe would cut lists at 200 entries
  return catalog()
}

function frames(value: number | undefined, fallback: number): number {
  return Math.min(MAX_PRESS_FRAMES, Math.max(0, Math.round(value ?? fallback)))
}

function dispatchKey(type: 'keydown' | 'keyup', key: AgentInputKey) {
  if (typeof document === 'undefined' || typeof KeyboardEvent === 'undefined') return false
  const dom = DOM_KEYS[key]
  const event = new KeyboardEvent(type, { key: dom.key, code: dom.code, bubbles: true, cancelable: true })
  // Old RPG Maker games and DOM demos may inspect the deprecated numeric fields.
  for (const field of ['keyCode', 'which'] as const) Object.defineProperty(event, field, { configurable: true, get: () => dom.keyCode })
  document.dispatchEvent(event)
  return true
}

function waitFrames(value: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.round((value * 1000) / 60)))
}

async function pressKey({ key, frames: requested, guard }: AgentParams<'input.press'>): Promise<unknown> {
  if (guard) checkInputGuard(key, guard)
  const input = g().Input as { _currentState?: Record<string, boolean> } | undefined
  const n = Math.max(1, frames(requested, DEFAULT_PRESS_FRAMES))
  if (!input?._currentState && typeof document === 'undefined') throw new Error('Input 未就绪（游戏尚未启动？）')
  if (input?._currentState) input._currentState[key] = true
  dispatchKey('keydown', key)
  await waitFrames(n)
  if (input?._currentState) input._currentState[key] = false
  dispatchKey('keyup', key)
  return { key, frames: n }
}

async function playSequence({ steps }: { steps: AgentInputStep[] }): Promise<unknown> {
  if (!Array.isArray(steps) || !steps.length) throw new Error('steps 不能为空')
  if (steps.length > MAX_SEQUENCE_STEPS) throw new Error(`steps 最多 ${MAX_SEQUENCE_STEPS} 个`)
  const actions = []
  for (const step of steps) {
    if (!step || !DOM_KEYS[step.key]) throw new Error(`无效按键：${String(step?.key)}`)
    actions.push(await pressKey(step))
    await waitFrames(frames(step.waitFrames, DEFAULT_WAIT_FRAMES))
  }
  return { actions, state: gameState() }
}

async function evalCode(code: string): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => () => Promise<unknown>
  return toJsonSafe(await new AsyncFunction(code)())
}

export type AgentRunOptions = {
  /** Only the local long-poll bridge (server-gated by CHAYA_MCP_EVAL) may eval */
  allowEval?: boolean
}

export async function runAgentCommand(cmd: AgentCommand, { allowEval = false }: AgentRunOptions = {}): Promise<unknown> {
  switch (cmd.method) {
    case 'game.state':
      return gameState()
    case 'game.history':
      return readHistory(cmd.params ?? {})
    case 'game.snap':
      return snapScreen(cmd.params ?? {})
    case 'game.quit':
      return quitGame()
    case 'plugins.list':
      return listPlugins()
    case 'plugin.tool':
      return callPluginTool(cmd.params)
    case 'input.press':
      return pressKey(cmd.params)
    case 'input.sequence':
      return playSequence(cmd.params)
    case 'input.tap':
      return tapScreen(cmd.params)
    case 'player.moveTo':
      return movePlayer(cmd.params)
    case 'edit.catalog':
      return editCatalog()
    case 'edit.state':
      return toJsonSafe(await agentEdit().state(), 6)
    case 'edit.apply':
      // Re-validated here: the DataChannel route is untrusted
      return toJsonSafe(await agentEdit().apply(parseEditOp((cmd.params?.op ?? {}) as Record<string, unknown>)))
    case 'edit.action':
      return toJsonSafe(await agentEdit().action(parseEditAction((cmd.params?.action ?? {}) as Record<string, unknown>)))
    case 'game.eval':
      if (!allowEval) throw new Error('此通道不允许执行 game.eval')
      return evalCode(cmd.params.code)
    default:
      throw new Error(`未知指令：${(cmd as { method?: string }).method}`)
  }
}
