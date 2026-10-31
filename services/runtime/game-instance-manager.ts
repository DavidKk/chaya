/**
 * 云游戏实例管理与闲置自动回收服务
 * 管理正在运行的游戏进程、WebRTC 连接态与监看截图，并提供无连接超时自动清理机制。
 */
import { getResolvedFromConfig } from '@/services/game/binding'
import { findRunningGameProcesses, terminateAllRunningGameProcesses, type RunningGameProcess } from '@/services/game/game-process'
import { displayNameFromPath, pathEquals } from '@/services/game/library'
import { callAgentGame, listAgentGames } from './agent-bridge'
import { listAllSignalingRooms, resetSignalingRoom } from './webrtc-signaling'

export type CloudGameInstance = {
  instanceId: string
  pid: number
  isMain: boolean
  command: string
  contentRoot?: string
  gameTitle: string
  roomId: string
  startedAt: number
  webConnected: boolean
  clientIp?: string
  lastActiveAt: number
  idleSeconds: number
  idleTimeoutSeconds: number
  remainingIdleSeconds: number
  screenshotUrl: string
  streamUrl: string
}

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 300 // 5 分钟无连接自动释放进程

// 跨 HMR 保持实例生命周期记录
type InstanceRuntimeState = {
  startedAt: number
  lastClientConnectedAt: number
}

const GLOBAL_KEY = '__chaya_game_instances_state_v1__'
const CLEANER_TIMER_KEY = '__chaya_idle_cleaner_timer_v1__'

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
    if (!state) {
      state = { startedAt: now, lastClientConnectedAt: now }
      store.set(key, state)
    }

    // 匹配信令房间
    const matchedRoom = rooms.find((r) => r.roomId !== 'default') || rooms[0]
    const roomId = matchedRoom?.roomId || (agentGames[0]?.gameId ?? 'default')

    // 检查是否有 Web 客户端处于连接中（35s 新鲜度）
    const isWebActive = Boolean(matchedRoom?.webConnected && now - matchedRoom.updatedAt <= 35_000)

    if (isWebActive) {
      state.lastClientConnectedAt = now
    }

    const idleSeconds = isWebActive ? 0 : Math.max(0, Math.floor((now - state.lastClientConnectedAt) / 1000))
    const remainingIdleSeconds = Math.max(0, DEFAULT_IDLE_TIMEOUT_SECONDS - idleSeconds)

    let title = defaultTitle
    if (proc.contentRoot) {
      title = displayNameFromPath(proc.contentRoot, { skipGeneric: true })
    }

    return {
      instanceId: `inst_${proc.pid}`,
      pid: proc.pid,
      isMain: proc.isMain,
      command: proc.command,
      contentRoot: proc.contentRoot,
      gameTitle: title,
      roomId,
      startedAt: state.startedAt,
      webConnected: isWebActive,
      clientIp: matchedRoom?.clientIp,
      lastActiveAt: state.lastClientConnectedAt,
      idleSeconds,
      idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
      remainingIdleSeconds,
      screenshotUrl: `/api/remote/screenshot?roomId=${encodeURIComponent(roomId)}`,
      streamUrl: `/play?room=${encodeURIComponent(roomId)}`,
    }
  })
}

/** 检查并回收超时未被任何玩家连接的闲置游戏进程 */
export async function checkAndReclaimIdleInstances(): Promise<{ reclaimed: number[] }> {
  const instances = listCloudGameInstances()
  if (!instances.length) return { reclaimed: [] }

  const reclaimed: number[] = []
  for (const inst of instances) {
    if (inst.idleSeconds >= inst.idleTimeoutSeconds) {
      console.warn(
        `[GameInstanceManager] 云游戏实例 (PID: ${inst.pid}, Root: ${inst.contentRoot || 'unknown'}) 已闲置 ${inst.idleSeconds}s（无人连接），正在自动清理以释放系统资源...`
      )
      const res = await terminateAllRunningGameProcesses(inst.contentRoot)
      reclaimed.push(...res.killed)
      if (inst.roomId) {
        resetSignalingRoom(inst.roomId)
      }
      getStateStore().delete(inst.contentRoot || String(inst.pid))
    }
  }

  return { reclaimed }
}

/** 手动结束游戏实例 */
export async function terminateCloudGameInstance(options?: { pid?: number; contentRoot?: string }): Promise<{ killed: number[] }> {
  const res = await terminateAllRunningGameProcesses(options?.contentRoot)
  if (options?.contentRoot) {
    getStateStore().delete(options.contentRoot)
  } else if (options?.pid) {
    getStateStore().delete(String(options.pid))
  } else {
    getStateStore().clear()
  }
  return res
}

/** 抓取游戏当前画面的快照（通过局内 ChayaAgent 的 game.snap 指令） */
export async function captureGameScreenshot(
  gameId = 'default',
  maxWidth = 800
): Promise<{ mimeType: string; data: string; width: number; height: number } | null> {
  try {
    const snap = (await callAgentGame(gameId, 'game.snap', { maxWidth }, 3000)) as {
      mimeType: string
      data: string
      width: number
      height: number
    }
    if (snap && snap.data && snap.mimeType) {
      return snap
    }
  } catch {
    /* ignore fallback to null */
  }
  return null
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

if (typeof window === "undefined" && process.env?.NODE_ENV !== "test") {
  ensureIdleCleanerStarted()
}
