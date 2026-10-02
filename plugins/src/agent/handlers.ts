/**
 * ChayaAgent command handlers — read RPG Maker state, call window.Chaya* plugins, press keys.
 */

import type { AgentCommand, AgentInputKey, AgentParams } from '@/lib/runtime/agent-protocol'

import { findPluginTool, listPluginToolMetas } from '../helpers/plugin-tools'

type Loose = Record<string, unknown>
type AnyFn = (...args: unknown[]) => unknown

const PLUGIN_GLOBAL = /^Chaya[A-Z]\w*$/
const DEFAULT_PRESS_FRAMES = 6
const MAX_PRESS_FRAMES = 600

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

function gameState(): unknown {
  const w = g()
  const scene = (w.SceneManager as Loose | undefined)?._scene as Loose | undefined
  const map = w.$gameMap
  const player = w.$gamePlayer as Loose | undefined
  const party = w.$gameParty
  const message = w.$gameMessage
  const mapId = read<number>(map, 'mapId')
  const mapInfos = w.$dataMapInfos as Array<{ name?: string } | null> | undefined
  const members = read<Loose[]>(party, 'members') ?? []
  return {
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
    message: message
      ? {
          busy: Boolean(read(message, 'isBusy')),
          speaker: read(message, 'speakerName') || null,
          text: read<string>(message, 'allText') || null,
          choices: read<boolean>(message, 'isChoice') ? (read<string[]>(message, 'choices') ?? []) : null,
        }
      : null,
  }
}

function methodNames(obj: object): string[] {
  const names = new Set<string>()
  for (let p: object | null = obj; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Object.getOwnPropertyNames(p)) {
      if (key === 'constructor' || key.startsWith('_')) continue
      try {
        if (typeof (obj as Loose)[key] === 'function') names.add(key)
      } catch {
        /* getter threw */
      }
    }
  }
  return [...names].sort()
}

function listPlugins(): unknown {
  const w = g()
  const tools = listPluginToolMetas()
  return Object.keys(w)
    .filter((key) => PLUGIN_GLOBAL.test(key) && w[key] && typeof w[key] === 'object')
    .sort()
    .map((key) => {
      const declared = tools.filter((tool) => tool.plugin === key).map(({ plugin: _plugin, ...meta }) => meta)
      return { name: key, methods: methodNames(w[key] as object), ...(declared.length ? { tools: declared } : {}) }
    })
}

async function callPluginTool({ plugin, tool, input = {} }: AgentParams<'plugin.tool'>): Promise<unknown> {
  const run = findPluginTool(plugin, tool)
  if (!run) throw new Error(`插件工具不存在：${plugin}.${tool}`)
  const result = await run(input && typeof input === 'object' && !Array.isArray(input) ? input : {})
  return result === undefined ? null : toJsonSafe(result)
}

async function callPlugin({ plugin, method, args = [], chain = [] }: AgentParams<'plugin.call'>): Promise<unknown> {
  if (!PLUGIN_GLOBAL.test(plugin)) throw new Error(`只能调用 window.Chaya* 插件，收到：${plugin}`)
  const target = g()[plugin]
  if (!target || typeof target !== 'object') throw new Error(`插件未加载：${plugin}`)
  let self: unknown = target
  let result: unknown = target
  for (const step of [{ method, args }, ...chain]) {
    if (result == null) throw new Error(`链式调用中断：${step.method} 前的返回值为空`)
    // Only listed methods of plain objects: function values / Object.prototype / constructor lead to `Function` (arbitrary code).
    if (typeof result !== 'object' || !methodNames(result).includes(step.method)) throw new Error(`方法不存在：${step.method}`)
    const fn = (result as Loose)[step.method]
    self = result
    result = await (fn as AnyFn).apply(self, step.args ?? [])
  }
  return result === target ? `[${plugin}]` : toJsonSafe(result)
}

function pressKey({ key, frames }: { key: AgentInputKey; frames?: number }): Promise<unknown> {
  const input = g().Input as { _currentState?: Record<string, boolean> } | undefined
  if (!input?._currentState) throw new Error('Input 未就绪（游戏尚未启动？）')
  const n = Math.min(MAX_PRESS_FRAMES, Math.max(1, Math.round(frames ?? DEFAULT_PRESS_FRAMES)))
  input._currentState[key] = true
  return new Promise((resolve) => {
    window.setTimeout(
      () => {
        if (input._currentState) input._currentState[key] = false
        resolve({ key, frames: n })
      },
      Math.round((n * 1000) / 60)
    )
  })
}

async function evalCode(code: string): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => () => Promise<unknown>
  return toJsonSafe(await new AsyncFunction(code)())
}

export async function runAgentCommand(cmd: AgentCommand): Promise<unknown> {
  switch (cmd.method) {
    case 'game.state':
      return gameState()
    case 'plugins.list':
      return listPlugins()
    case 'plugin.call':
      return callPlugin(cmd.params)
    case 'plugin.tool':
      return callPluginTool(cmd.params)
    case 'input.press':
      return pressKey(cmd.params)
    case 'game.eval':
      return evalCode(cmd.params.code)
    default:
      throw new Error(`未知指令：${(cmd as { method?: string }).method}`)
  }
}
