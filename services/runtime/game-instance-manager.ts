/**
 * 云游戏实例管理与闲置自动回收服务
 * 管理正在运行的游戏进程、WebRTC 连接态与监看截图，并提供无连接超时自动清理机制。
 */
import fs from 'node:fs'
import path from 'node:path'

import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { DEFAULT_REMOTE_PLAY_HOST_SETTINGS, parseRemotePlayHostSettings, type RemotePlayHostSettings } from '@/lib/runtime/remote-play-settings'
import { getResolvedFromConfig } from '@/services/game/binding'
import { loadConfig } from '@/services/game/config'
import { findRunningGameProcesses, type RunningGameProcess, terminateAllRunningGameProcesses } from '@/services/game/game-process'
import { displayNameFromPath, findLibraryEntry } from '@/services/game/library'
import { rgssRuntimeStatus } from '@/services/game/rgss-runtime'

import { listAgentGames } from './agent-bridge'
import { clearGamePreviews } from './game-preview'
import { gameRunMode } from './playable-games'
export { captureGamePreview as captureGameScreenshot } from './game-preview'
import { listAllSignalingRooms, resetSignalingRoom } from './webrtc-signaling'

export type CloudGameInstance = {
  instanceId: string
  pid: number
  isMain: boolean
  command: string
  contentRoot?: string
  gameTitle: string
  roomId: string
  libraryId?: string
  startedAt: number
  webConnected: boolean
  clientIp?: string
  lastActiveAt: number
  idleSeconds: number
  idleTimeoutSeconds: number
  remainingIdleSeconds: number
  runMode: 'local' | 'cloud'
  screenshotUrl: string
  streamUrl: string
}

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 300 // 5 分钟无连接自动释放进程

// 跨 HMR 保持实例生命周期记录
type InstanceRuntimeState = {
  pid?: number
  startedAt: number
  lastClientConnectedAt: number
}

const GLOBAL_KEY = '__chaya_game_instances_state_v1__'
const CLEANER_TIMER_KEY = '__chaya_idle_cleaner_timer_v1__'

export function readConfiguredRemotePlayHostSettings(): RemotePlayHostSettings {
  try {
    const file = path.join(toolkitDataDir(), 'remote-play/settings.json')
    if (fs.existsSync(file)) {
      return parseRemotePlayHostSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
    }
  } catch {
    /* fallback */
  }
  return { ...DEFAULT_REMOTE_PLAY_HOST_SETTINGS }
}

function getStateStore(): Map<string, InstanceRuntimeState> {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Map<string, InstanceRuntimeState> }
  return (g[GLOBAL_KEY] ??= new Map())
}

function resolveInstanceKey(proc: RunningGameProcess): string {
  return proc.contentRoot || String(proc.pid)
}

/** 获取所有正在运行的云游戏实例信息 */
export function listCloudGameInstances(): CloudGameInstance[] {
  const processes = findRunningGameProcesses()
  if (!processes.length) return []

  const store = getStateStore()
  const now = Date.now()
  const rooms = listAllSignalingRooms()
  const agentGames = listAgentGames()

  let defaultTitle = 'RPG Maker Game'
  try {
    const resolved = getResolvedFromConfig()
    if (resolved.ok && resolved.contentRoot) {
      defaultTitle = displayNameFromPath(resolved.contentRoot, { skipGeneric: true })
    }
  } catch {
    /* */
  }

  const mainProcesses = processes.filter((p) => p.isMain)
  const effectiveProcesses = mainProcesses.length > 0 ? mainProcesses : processes.slice(0, 1)

  return effectiveProcesses.map((proc) => {
    const key = resolveInstanceKey(proc)
    let state = store.get(key)
    if (!state || state.pid !== proc.pid) {
      state = { pid: proc.pid, startedAt: now, lastClientConnectedAt: now }
      store.set(key, state)
    }

    // 匹配信令房间
    const matchedRoom = rooms.find((r) => r.roomId !== 'default' && !r.roomId.endsWith(':observer')) || rooms.find((r) => !r.roomId.endsWith(':observer')) || rooms[0]
    let roomId = matchedRoom?.roomId || (agentGames[0]?.gameId ?? 'default')
    let isWebActive = Boolean(matchedRoom?.webConnected && now - matchedRoom.updatedAt <= 35_000)

    let title = defaultTitle
    let libraryId: string | undefined
    if (proc.contentRoot) {
      title = displayNameFromPath(proc.contentRoot, { skipGeneric: true })
      try {
        const cfg = loadConfig()
        const entry = findLibraryEntry(cfg.library, proc.contentRoot)
        if (entry?.id) libraryId = entry.id
      } catch {}
    }

    // 若为 RGSS 原生进程，优先使用其绑定的专属信令房间与就绪状态
    if (proc.contentRoot) {
      const rgss = rgssRuntimeStatus(proc.contentRoot)
      if (rgss.roomId) {
        roomId = rgss.roomId
      } else if (libraryId) {
        roomId = libraryId
      }
      const obsRoom = rooms.find((r) => r.roomId === `${roomId}:observer`)
      const mainRoom = rooms.find((r) => r.roomId === roomId)
      if (rgss.bridgeConnected || (mainRoom?.webConnected && now - mainRoom.updatedAt <= 35_000) || (obsRoom?.webConnected && now - obsRoom.updatedAt <= 35_000)) {
        isWebActive = true
      }
    }

    if (isWebActive) {
      state.lastClientConnectedAt = now
    }

    const hostSettings = readConfiguredRemotePlayHostSettings()
    const configuredTimeout = hostSettings.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS
    const idleSeconds = isWebActive ? 0 : Math.max(0, Math.floor((now - state.lastClientConnectedAt) / 1000))
    const remainingIdleSeconds = configuredTimeout > 0 ? Math.max(0, configuredTimeout - idleSeconds) : 0

    return {
      instanceId: `inst_${proc.pid}`,
      pid: proc.pid,
      isMain: proc.isMain,
      command: proc.command,
      contentRoot: proc.contentRoot,
      gameTitle: title,
      roomId,
      libraryId,
      startedAt: state.startedAt,
      webConnected: isWebActive,
      clientIp: matchedRoom?.clientIp,
      lastActiveAt: state.lastClientConnectedAt,
      idleSeconds,
      idleTimeoutSeconds: configuredTimeout,
      remainingIdleSeconds,
      runMode: gameRunMode(proc),
      screenshotUrl: `/api/remote/screenshot?roomId=${encodeURIComponent(roomId)}`,
      streamUrl: `/play?room=${encodeURIComponent(roomId)}`,
    }
  })
}

/** 检查并回收超时未被任何玩家连接的闲置游戏进程 */
export async function checkAndReclaimIdleInstances(timeoutOverride?: number): Promise<{ reclaimed: number[] }> {
  const hostSettings = timeoutOverride !== undefined ? { ...readConfiguredRemotePlayHostSettings(), idleTimeoutSeconds: timeoutOverride } : readConfiguredRemotePlayHostSettings()
  const configuredTimeout = hostSettings.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS
  if (configuredTimeout <= 0) return { reclaimed: [] }

  const instances = listCloudGameInstances()
  if (!instances.length) return { reclaimed: [] }

  const reclaimed: number[] = []
  const playing = new Set<string>()
  for (const game of listAgentGames()) {
    playing.add(game.gameId)
    if (game.contentRoot) playing.add(path.resolve(game.contentRoot))
  }
  for (const inst of instances) {
    // A page or dev reload drops the web connection. The game stays while its plugin is still polling.
    const pluginAlive = (inst.libraryId && playing.has(inst.libraryId)) || (inst.contentRoot && playing.has(path.resolve(inst.contentRoot))) || false
    if (pluginAlive) {
      const state = getStateStore().get(inst.contentRoot || String(inst.pid))
      if (state) state.lastClientConnectedAt = Date.now()
      continue
    }
    if (inst.runMode === 'cloud' && inst.idleTimeoutSeconds > 0 && inst.idleSeconds >= inst.idleTimeoutSeconds) {
      process.emitWarning(`[GameInstanceManager] Reclaiming idle game instance (PID: ${inst.pid}, root: ${inst.contentRoot || 'unknown'}, idle: ${inst.idleSeconds}s)`)
      const res = await terminateAllRunningGameProcesses(inst.contentRoot)
      reclaimed.push(...res.killed)
      if (inst.roomId) {
        resetSignalingRoom(inst.roomId)
      }
      getStateStore().delete(inst.contentRoot || String(inst.pid))
      clearGamePreviews()
    }
  }

  return { reclaimed }
}

/** 手动结束游戏实例 */
export async function terminateCloudGameInstance(options?: { pid?: number; contentRoot?: string }): Promise<{ killed: number[] }> {
  const res = await terminateAllRunningGameProcesses(options?.contentRoot)
  clearGamePreviews()
  if (options?.contentRoot) {
    getStateStore().delete(options.contentRoot)
  } else if (options?.pid) {
    getStateStore().delete(String(options.pid))
  } else {
    getStateStore().clear()
  }
  return res
}

/** 启动后台定期巡检定时器（每 15 秒检查一次闲置状态） */
export function ensureIdleCleanerStarted(): void {
  const g = globalThis as typeof globalThis & { [CLEANER_TIMER_KEY]?: ReturnType<typeof setInterval> }
  if (g[CLEANER_TIMER_KEY]) return

  g[CLEANER_TIMER_KEY] = setInterval(() => {
    void checkAndReclaimIdleInstances().catch(() => {})
  }, 15_000)
}

// 服务端自动激活后台巡检
export function stopIdleCleaner(): void {
  const g = globalThis as typeof globalThis & { [CLEANER_TIMER_KEY]?: ReturnType<typeof setInterval> }
  if (g[CLEANER_TIMER_KEY]) {
    clearInterval(g[CLEANER_TIMER_KEY])
    delete g[CLEANER_TIMER_KEY]
  }
}

if (typeof window === 'undefined' && process.env?.NODE_ENV !== 'test') {
  ensureIdleCleanerStarted()
}
