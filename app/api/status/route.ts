import path from 'node:path'

import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { resolveToolkitShellAppPath } from '@/lib/game'
import { canUseDisk, requireDisk, serviceModePayload } from '@/lib/service-mode'
import {
  detectPlugins,
  displayNameFromPath,
  findLibraryEntry,
  formatBytes,
  getResolvedFromConfig,
  isToolkitShellInstalled,
  loadConfig,
  measureDirSizeBytes,
  pathEquals,
  readNwPackage,
  readTranslateSwitches,
  removeLibraryEntry,
  resolveGame,
  saveConfig,
  toLibraryItemView,
  TRACKED_PLUGINS,
  upsertLibraryEntry,
} from '@/services/game'
import { acceptGameBindEpoch, peekGameBindEpoch } from '@/services/game/bind-epoch'
import { anyWebConnected, detectLanApiBases, getGamePresence, preferredPluginApiBase, toolkitListenPort } from '@/services/runtime'
import { getSharedTranslateCacheStats } from '@/services/translate'
import { gameCacheFileStats } from '@/services/translate/cache-file-stats'

export const runtime = 'nodejs'

function runtimePayload() {
  const port = toolkitListenPort()
  const presence = getGamePresence()
  // 权威在线：WebRTC DataChannel；HTTP presence 仅作兼容/远程入库痕迹
  const gameOnline = anyWebConnected() || presence.online
  return {
    gameOnline,
    presence,
    apiBase: preferredPluginApiBase(port),
    lanBases: detectLanApiBases(port),
    loopback: `http://127.0.0.1:${port}`,
  }
}

function platformPayload() {
  return {
    platform: process.platform,
    shellPath: resolveToolkitShellAppPath(),
    shellKind: process.platform === 'win32' ? 'nw-dir' : 'app-bundle',
  }
}

function resolveDisplayName(contentRoot: string, gameRoot: string): string {
  const pkg = readNwPackage(contentRoot)
  const title = pkg?.window.title?.trim()
  const name = pkg?.name?.trim()
  return title || name || displayNameFromPath(gameRoot)
}

/** 无盘形态：不下探用户盘 / toolkit data，只回形态字段 */
function remoteOnlyStatus() {
  const service = serviceModePayload()
  return {
    ready: false as const,
    ...service,
    config: { gameRoot: '', shellSource: '' },
    library: [] as ReturnType<typeof toLibraryItemView>[],
    error: '当前为云端形态，本机磁盘能力不可用',
    bindEpoch: 0,
    runtime: {
      gameOnline: false,
      presence: getGamePresence(),
      apiBase: null as string | null,
      lanBases: [] as string[],
      loopback: null as string | null,
    },
    host: {
      platform: process.platform,
      shellPath: null as string | null,
      shellKind: process.platform === 'win32' ? 'nw-dir' : 'app-bundle',
    },
  }
}

export const GET = defineApiRoute('get:/api/status', async () => {
  const service = serviceModePayload()
  if (!canUseDisk(service.serviceMode)) {
    return remoteOnlyStatus()
  }

  const config = loadConfig()
  const resolved = getResolvedFromConfig()
  const library = config.library.map(toLibraryItemView)
  const bindEpoch = peekGameBindEpoch()

  if (!resolved.ok) {
    return {
      ready: false,
      ...service,
      config,
      library,
      error: resolved.error,
      bindEpoch,
      runtime: runtimePayload(),
      host: platformPayload(),
    }
  }

  if (resolved.remote) {
    return {
      ready: true,
      ...service,
      remote: true,
      config,
      library,
      bindEpoch,
      selected: resolved.selected,
      contentRoot: resolved.contentRoot,
      projectRoot: resolved.projectRoot,
      kind: resolved.kind,
      shellApp: resolved.shellApp,
      hasShell: false,
      bundled: false,
      installedShell: isToolkitShellInstalled(),
      nestedInApp: false,
      footprint: {
        contentBytes: null,
        contentLabel: null,
        shellBytes: null,
        shellLabel: null,
      },
      cache: { entries: 0, file: null, sizeBytes: 0 },
      sharedCache: getSharedTranslateCacheStats(),
      plugins: TRACKED_PLUGINS.map((name) => ({
        name,
        registered: false,
        enabled: false,
        fileExists: false,
        kitSource: null,
      })),
      pluginsReady: 0,
      pluginsTotal: TRACKED_PLUGINS.length,
      translateSwitches: { file: null, switches: null },
      nwPackage: null,
      runtime: runtimePayload(),
      host: platformPayload(),
    }
  }

  const switches = readTranslateSwitches(resolved.contentRoot)
  const nwPackage = readNwPackage(resolved.contentRoot)
  const contentBytes = measureDirSizeBytes(resolved.contentRoot)
  const shellBytes =
    resolved.hasShell && resolved.shellApp !== resolved.contentRoot && !resolved.contentRoot.startsWith(resolved.shellApp + path.sep)
      ? measureDirSizeBytes(resolved.shellApp)
      : null
  const plugins = detectPlugins(resolved.contentRoot)
  const pluginsReady = plugins.filter((p) => p.fileExists && p.registered).length

  return {
    ready: true,
    ...service,
    remote: false,
    config,
    library,
    bindEpoch,
    selected: resolved.selected,
    contentRoot: resolved.contentRoot,
    projectRoot: resolved.projectRoot,
    kind: resolved.kind,
    shellApp: resolved.shellApp,
    hasShell: resolved.hasShell,
    bundled: resolved.bundled,
    /** 工具 data/shell 下是否有用户安装的共用壳（可卸载） */
    installedShell: isToolkitShellInstalled(),
    /** @deprecated 同 bundled；内容已在 .app 内表示壳就绪，非错误 */
    nestedInApp: resolved.bundled,
    footprint: {
      contentBytes,
      contentLabel: formatBytes(contentBytes),
      shellBytes,
      shellLabel: formatBytes(shellBytes),
    },
    cache: gameCacheFileStats(resolved.contentRoot),
    sharedCache: getSharedTranslateCacheStats(),
    plugins,
    pluginsReady,
    pluginsTotal: plugins.length,
    translateSwitches: switches,
    nwPackage,
    runtime: runtimePayload(),
    host: platformPayload(),
  }
})

export const PUT = defineApiRoute('put:/api/status', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    gameRoot?: string
    path?: string
    shellSource?: string
    remark?: string | null
    /** 切换游戏时的客户端序号；过期请求不改 gameRoot */
    bindEpoch?: number
  }
  const input = String(body.gameRoot || body.path || '').trim()
  const hasRemark = Object.prototype.hasOwnProperty.call(body, 'remark')
  if (!input && body.shellSource === undefined && !hasRemark) {
    return apiBadRequest('缺少 gameRoot、shellSource 或 remark')
  }

  if (hasRemark) {
    const prev = loadConfig()
    const root = input || prev.gameRoot
    if (!String(root || '').trim()) {
      return apiBadRequest('尚未绑定游戏，无法写备注')
    }
    const existing = findLibraryEntry(prev.library, root)
    if (!existing) {
      return apiBadRequest('游戏库中未找到该条目')
    }
    const config = saveConfig({
      library: upsertLibraryEntry(prev.library, {
        gameRoot: existing.gameRoot,
        name: existing.name,
        remote: existing.remote,
        remark: body.remark,
        touchOpen: false,
      }),
      ...(input ? { gameRoot: existing.gameRoot } : {}),
      ...(body.shellSource !== undefined ? { shellSource: String(body.shellSource || '').trim() } : {}),
    })
    return apiOk({
      config,
      resolved: getResolvedFromConfig(),
      library: config.library.map(toLibraryItemView),
    })
  }

  if (input) {
    const epochGate = acceptGameBindEpoch(body.bindEpoch)
    if (!epochGate.ok) {
      const config = loadConfig()
      return apiOk({
        config,
        resolved: getResolvedFromConfig(),
        library: config.library.map(toLibraryItemView),
        ignoredStaleBind: true,
        bindEpoch: epochGate.latest,
      })
    }

    const prev = loadConfig()
    const existing = findLibraryEntry(prev.library, input)
    if (existing?.remote) {
      const config = saveConfig({
        gameRoot: existing.gameRoot,
        library: upsertLibraryEntry(prev.library, {
          gameRoot: existing.gameRoot,
          name: existing.name,
          remote: true,
          remark: existing.remark ?? null,
        }),
        ...(body.shellSource !== undefined ? { shellSource: String(body.shellSource || '').trim() } : {}),
      })
      return apiOk({
        config,
        resolved: getResolvedFromConfig(),
        library: config.library.map(toLibraryItemView),
        bindEpoch: epochGate.epoch,
      })
    }

    const check = resolveGame(input)
    if (!check.ok) {
      return apiBadRequest(check.error)
    }
    // 已是当前选中且库路径一致：不写盘（避免 lastOpenedAt 抖动触发控制台重复 PUT）
    if (existing && pathEquals(prev.gameRoot, check.selected) && pathEquals(existing.gameRoot, check.selected)) {
      return apiOk({
        config: prev,
        resolved: check,
        library: prev.library.map(toLibraryItemView),
        bindEpoch: epochGate.epoch,
        unchanged: true,
      })
    }
    const name = resolveDisplayName(check.contentRoot, input)
    const config = saveConfig({
      gameRoot: check.selected,
      library: upsertLibraryEntry(prev.library, {
        gameRoot: check.selected,
        name,
        remote: false,
        remark: existing?.remark ?? null,
      }),
      ...(body.shellSource !== undefined ? { shellSource: String(body.shellSource || '').trim() } : {}),
    })
    return apiOk({ config, resolved: check, library: config.library.map(toLibraryItemView), bindEpoch: epochGate.epoch })
  }

  const config = saveConfig({
    shellSource: String(body.shellSource || '').trim(),
  })
  return apiOk({ config, library: config.library.map(toLibraryItemView) })
})

export const DELETE = defineApiRoute('delete:/api/status', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as { gameRoot?: string }
  const target = String(body.gameRoot || '').trim()
  const prev = loadConfig()

  if (!target) {
    const config = saveConfig({ gameRoot: '' })
    return apiOk({ config, ready: false, library: config.library.map(toLibraryItemView) })
  }

  const library = removeLibraryEntry(prev.library, target)
  let gameRoot = prev.gameRoot
  if (pathEquals(gameRoot, target)) {
    gameRoot = ''
  }

  const config = saveConfig({ gameRoot, library })
  const resolved = gameRoot ? resolveGame(gameRoot) : { ok: false as const, error: '' }
  return apiOk({
    config,
    ready: resolved.ok,
    switchedTo: null,
    library: config.library.map(toLibraryItemView),
  })
})
