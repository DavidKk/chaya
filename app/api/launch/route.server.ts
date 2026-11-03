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
  writeNwWindow,
} from '@/services/disk-ops'
import { findRunningJob } from '@/services/downloads/jobs'
import { ensureGameAppIcon, updateSharedMacAppIcon } from '@/services/game/app-icon'
import { findRunningGameProcesses, terminateAllRunningGameProcesses } from '@/services/game/game-process'
import { pathEquals } from '@/services/game/library'
import { launchRgss, quitRgss, rgssRuntimeStatus } from '@/services/game/rgss-runtime'
import { anyWebConnected, clearGameQuitRequest, getGamePresence, preferredPluginApiBase, requestGameQuit, toolkitListenPort, writeLaunchEnv } from '@/services/runtime'
import { terminateCloudGameInstance } from '@/services/runtime/game-instance-manager'
import { recordGameLaunch } from '@/services/runtime/playable-games'
import { readRemotePlayHostSettings } from '@/services/runtime/remote-play-settings.server'

export const runtime = 'nodejs'

/** Launch: Ensure loader, environment, and disk cache, then launch shell or open directory. */
export const POST = defineApiRoute('post:/api/launch', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  let mode: 'silent' | 'windowed' = 'windowed'
  let muteHostAudio: boolean | undefined
  const raw = await request.json().catch(() => null)
  if (raw && typeof raw === 'object') {
    if (raw.remotePlay === true) {
      const settings = readRemotePlayHostSettings()
      mode = settings.launchMode
      muteHostAudio = mode === 'silent' ? settings.muteHostAudio : false
    } else if (raw.mode === 'silent') {
      mode = 'silent'
      muteHostAudio = true
    }
    if (raw.mute === true || raw.muteHostAudio === true) {
      muteHostAudio = true
    }
  }
  const isSilent = mode === 'silent'

  let resolved = getResolvedFromConfig()
  if (!resolved.ok) return apiBadRequest(resolved.error || 'No game bound yet')
  if (resolved.remote) return apiBadRequest('Remote game cannot be launched locally', 'REMOTE_READ_ONLY')
  if (resolved.engine === 'VX Ace' || resolved.engine === 'VX') {
    if (findRunningJob('rgss-shell')) return apiError(409, 'SHELL_JOB_RUNNING', 'mkxp-z installation is in progress')
    if (!resolved.hasShell) return apiBadRequest('Install the native mkxp-z runtime to launch VX / VX Ace on macOS', 'RGSS_RUNTIME_MISSING')

    const targetContentRoot = resolved.contentRoot
    const targetShellApp = resolved.shellApp
    const rgssStatus = rgssRuntimeStatus(targetContentRoot)
    const runningProcesses = findRunningGameProcesses(targetContentRoot)
    const isSameGameRunning = rgssStatus.running || runningProcesses.length > 0

    if (isSameGameRunning) {
      const apiBase = preferredPluginApiBase(toolkitListenPort())
      return apiOk({
        path: targetShellApp,
        contentRoot: targetContentRoot,
        mode: 'already-running',
        alreadyRunning: true,
        roomId: rgssStatus.roomId,
        engine: resolved.engine,
        apiBase,
      })
    }

    // Switching or launching a new game: ensure previous instances are terminated
    await terminateCloudGameInstance()
    await new Promise((resolve) => setTimeout(resolve, 300))
    clearGameQuitRequest()

    try {
      const result = await launchRgss(resolved, { silent: isSilent, ...(muteHostAudio !== undefined ? { muteHostAudio } : {}) })
      recordGameLaunch(targetContentRoot, raw?.remotePlay === true || isSilent ? 'cloud' : 'local')
      return apiOk(result)
    } catch (error) {
      return apiError(500, 'LAUNCH_FAILED', error instanceof Error ? error.message : String(error))
    }
  }

  if (findRunningJob('nw-shell') || isShellInstalling()) {
    return apiError(409, 'SHELL_JOB_RUNNING', 'Downloading and installing NW.js, please wait until the download center task finishes before launching')
  }

  const runningProcesses = findRunningGameProcesses()
  const targetContentRoot = resolved.ok ? resolved.contentRoot : undefined
  const targetShellApp = resolved.ok ? resolved.shellApp : ''
  const isSameGameRunning = runningProcesses.some((p) => !targetContentRoot || !p.contentRoot || pathEquals(p.contentRoot, targetContentRoot))
  const presence = getGamePresence()
  const isSamePresenceOnline = presence.online && (!targetContentRoot || !presence.contentRoot || pathEquals(presence.contentRoot, targetContentRoot))

  // If the game process or WebRTC connection is already active, return ready without launching duplicate instances
  if (isSameGameRunning || anyWebConnected() || isSamePresenceOnline) {
    const apiBase = preferredPluginApiBase(toolkitListenPort())
    return apiOk({
      path: targetShellApp,
      contentRoot: targetContentRoot,
      mode: 'already-running',
      alreadyRunning: true,
      apiBase,
    })
  }

  // Switching or launching a new game: ensure previous cloud instances are terminated
  if (runningProcesses.length > 0) {
    await terminateCloudGameInstance()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  clearGameQuitRequest()

  try {
    recoverOldIfNeeded()
  } catch (err) {
    return apiError(500, 'SHELL_SWAP_RECOVERY_REQUIRED', err instanceof Error ? err.message : String(err))
  }
  // Recovery may restore the shell path; do not keep the pre-recovery snapshot.
  resolved = getResolvedFromConfig()
  if (!resolved.ok) return apiBadRequest(resolved.error || 'No game bound yet')
  if (resolved.remote) return apiBadRequest('Remote game cannot be launched locally', 'REMOTE_READ_ONLY')
  if (!resolved.hasShell) {
    return apiBadRequest('NW.js shell is not installed, cannot launch')
  }

  try {
    // Some Windows game packages lack package.json name which NW.js requires
    try {
      writeNwWindow(resolved.contentRoot, { show: !isSilent })
    } catch {
      /* ignore */
    }
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
    const { env, session } = writeLaunchEnv(resolved, apiBase, { silentMode: isSilent, ...(muteHostAudio !== undefined ? { muteHostAudio } : {}) })

    if (resolved.bundled) {
      await openInFinder(resolved.shellApp)
      recordGameLaunch(resolved.contentRoot, raw?.remotePlay === true || isSilent ? 'cloud' : 'local')
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
    await launchShellWithContent(resolved.shellApp, resolved.contentRoot, { silent: isSilent })
    recordGameLaunch(resolved.contentRoot, raw?.remotePlay === true || isSilent ? 'cloud' : 'local')
    return apiOk({
      path: resolved.shellApp,
      contentRoot: resolved.contentRoot,
      mode: isSilent ? 'shared-shell-silent' : 'shared-shell',
      silent: isSilent,
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

/** Terminate: Legacy endpoint; modern clients issue quit via WebRTC DataChannel */
export const DELETE = defineApiRoute('delete:/api/launch', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (resolved.ok && !resolved.remote && (resolved.engine === 'VX Ace' || resolved.engine === 'VX')) {
    quitRgss(resolved.contentRoot)
  }

  await terminateAllRunningGameProcesses()
  clearGameQuitRequest()
  const next = requestGameQuit()
  return apiOk({ quit: true, presence: next })
})
