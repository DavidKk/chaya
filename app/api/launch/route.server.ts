import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import {
  ensureNwPackageName,
  ensureShellLinkedToContent,
  getResolvedFromConfig,
  injectTrackedPlugins,
  isShellInstalling,
  launchShellWithContent,
  openInFinder,
  recoverOldIfNeeded,
  requireDisk,
} from '@/services/disk-ops'
import { findRunningJob } from '@/services/downloads/jobs'
import { ensureGameAppIcon, updateSharedMacAppIcon } from '@/services/game/app-icon'
import { anyWebConnected, clearGameQuitRequest, getGamePresence, preferredPluginApiBase, requestGameQuit, toolkitListenPort, writeLaunchEnv } from '@/services/runtime'

export const runtime = 'nodejs'

/** 启动：确保 Loader + Env（含 launchToken）+ 磁盘缓存，再 open / 传参启动 */
export const POST = defineApiRoute('post:/api/launch', async () => {
  const denied = requireDisk()
  if (denied) return denied

  if (findRunningJob('nw-shell') || isShellInstalling()) {
    return apiError(409, 'SHELL_JOB_RUNNING', 'Downloading and installing NW.js, please wait until the download center task finishes before launching')
  }

  if (anyWebConnected()) {
    return apiBadRequest('Game is already running (WebRTC connected)', 'ALREADY_RUNNING')
  }
  clearGameQuitRequest()

  try {
    recoverOldIfNeeded()
  } catch (err) {
    return apiError(500, 'SHELL_SWAP_RECOVERY_REQUIRED', err instanceof Error ? err.message : String(err))
  }
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error || 'No game bound yet')
  }
  if (!resolved.hasShell) {
    return apiBadRequest('NW.js shell is not installed, cannot launch')
  }
  if (resolved.remote) {
    return apiBadRequest('Remote game cannot be launched locally', 'REMOTE_READ_ONLY')
  }

  try {
    // 部分 Windows 发布包 package.json name 为空，NW.js 会直接拒启
    const nwPackage = ensureNwPackageName(resolved.contentRoot)
    let gameIcon: string | undefined
    if (!resolved.bundled) {
      try {
        gameIcon = (await ensureGameAppIcon(resolved.contentRoot)).icon
      } catch (error) {
        process.emitWarning(error instanceof Error ? error : String(error), { code: 'CHAYA_GAME_ICON' })
      }
    }
    const apiBase = preferredPluginApiBase(toolkitListenPort())
    const plugins = injectTrackedPlugins(resolved.contentRoot)
    if (plugins.missingKit.length && plugins.copied.length === 0) {
      return apiBadRequest(`Missing plugin build artifacts: ${plugins.missingKit.join('、')} (run pnpm build:plugins first)`, 'PLUGINS_MISSING')
    }
    if (plugins.pluginsJsMissing) {
      return apiBadRequest(`Missing js/plugins.js in content root: ${resolved.contentRoot}`)
    }
    if (plugins.pluginsJsParseFailed) {
      return apiError(500, 'PLUGINS_JS_PARSE_FAILED', `Failed to parse js/plugins.js ($plugins array format invalid): ${resolved.contentRoot}`)
    }
    const { env, session } = writeLaunchEnv(resolved, apiBase)

    if (resolved.bundled) {
      await openInFinder(resolved.shellApp)
      return apiOk({
        path: resolved.shellApp,
        mode: 'bundled',
        apiBase,
        env,
        launchToken: session.token,
        launchTokenPersistence: session.persistence,
        plugins,
        nwPackage,
      })
    }

    ensureShellLinkedToContent({
      shellApp: resolved.shellApp,
      contentRoot: resolved.contentRoot,
    })
    if (gameIcon) {
      try {
        await updateSharedMacAppIcon(resolved.shellApp, resolved.contentRoot, gameIcon)
      } catch (error) {
        process.emitWarning(error instanceof Error ? error : String(error), { code: 'CHAYA_MAC_APP_ICON' })
      }
    }
    await launchShellWithContent(resolved.shellApp, resolved.contentRoot)
    return apiOk({
      path: resolved.shellApp,
      contentRoot: resolved.contentRoot,
      mode: 'shared-shell',
      apiBase,
      env,
      launchToken: session.token,
      launchTokenPersistence: session.persistence,
      plugins,
      nwPackage,
    })
  } catch (err) {
    return apiError(500, 'LAUNCH_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 关闭：兼容路径；主路径已改 WebRTC DataChannel quit */
export const DELETE = defineApiRoute('delete:/api/launch', async () => {
  const denied = requireDisk()
  if (denied) return denied

  if (!anyWebConnected() && !getGamePresence().online) {
    clearGameQuitRequest()
    return apiBadRequest('No active game session online', 'NOT_RUNNING')
  }
  const next = requestGameQuit()
  return apiOk({ quit: true, presence: next })
})
