import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, installShell, isShellInstalling, isToolkitShellInstalled, requireDisk, saveConfig, uninstallToolkitShell } from '@/services/disk-ops'
import { findRunningJob } from '@/services/downloads/jobs'
import { getNwShellUpdate } from '@/services/game/nw-update'
import { getRgssShellUpdate, startRgssInstallJob } from '@/services/game/rgss-install'
import { anyRgssRunning, uninstallRgssRuntime } from '@/services/game/rgss-runtime'
import { startLatestShellJob } from '@/services/game/shell-job'

export const runtime = 'nodejs'
/** `wait` 时同步等待下载；Hobby 上限 300s（自托管忽略） */
export const maxDuration = 300

export const GET = defineApiRoute('get:/api/shell', async () => {
  const denied = requireDisk()
  if (denied) return denied
  const resolved = getResolvedFromConfig()
  if (!resolved.ok || resolved.remote || resolved.bundled || !resolved.hasShell) {
    return apiOk({ available: false })
  }
  if (resolved.engine === 'VX Ace' || resolved.engine === 'VX') return apiOk(await getRgssShellUpdate())
  return apiOk(await getNwShellUpdate(resolved.shellApp))
})

function shellJobRunning() {
  return apiError(409, 'SHELL_JOB_RUNNING', 'Downloading and installing NW.js, please wait until the download center task finishes before proceeding')
}

export const POST = defineApiRoute('post:/api/shell', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    shellSource?: string
    /** 从 nwjs.io 拉取当前平台最新包并强制装入 data/shell；默认后台任务立即返回 202 */
    fetchLatest?: boolean
    /** 等待后台任务结束再返回（MCP 等无轮询调用方） */
    wait?: boolean
    force?: boolean
  }
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }
  if (resolved.remote) {
    return apiBadRequest('Remote game cannot install shell locally', 'REMOTE_READ_ONLY')
  }
  if (resolved.engine === 'VX Ace' || resolved.engine === 'VX') {
    if (process.platform !== 'darwin') return apiBadRequest('mkxp-z automatic installation currently supports macOS only', 'RGSS_PLATFORM')
    if (anyRgssRunning()) return apiError(409, 'ALREADY_RUNNING', 'Quit the RGSS game before installing its runtime')
    if (!body.fetchLatest) return apiBadRequest('Use Download Latest to install the native mkxp-z runtime', 'RGSS_RUNTIME_SOURCE')
    const { job, done, reused } = startRgssInstallJob()
    if (!body.wait) return apiOk({ job, reused }, { status: 202 })
    const finished = await done
    if (finished.status !== 'done') return apiBadRequest(finished.error || 'Download cancelled')
    return apiOk({ ...finished.result, job: finished })
  }

  try {
    if (body.fetchLatest) {
      const { job, done, reused } = startLatestShellJob(resolved.contentRoot)
      if (!body.wait) return apiOk({ job, reused }, { status: 202 })
      const finished = await done
      if (finished.status !== 'done') return apiBadRequest(finished.error || 'Download cancelled')
      return apiOk({ ...finished.result, job: finished })
    }

    if (findRunningJob('nw-shell')) return shellJobRunning()
    const shellSource = String(body.shellSource || resolved.config.shellSource || '').trim()
    if (!shellSource) {
      return apiBadRequest('Please provide a valid NW.js shellSource path or use "Download Latest Shell"')
    }

    const result = await installShell({
      shellSource,
      contentRoot: resolved.contentRoot,
      force: !!body.force,
    })
    const config = saveConfig({ shellSource })
    return apiOk({ ...result, config })
  } catch (err) {
    return apiBadRequest(err instanceof Error ? err.message : String(err))
  }
})

/** 卸载工具目录里用户安装的共用 NW.js 壳（不影响壳源与已打包游戏） */
export const DELETE = defineApiRoute('delete:/api/shell', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (resolved.ok && !resolved.remote && (resolved.engine === 'VX Ace' || resolved.engine === 'VX')) {
    if (findRunningJob('rgss-shell')) return apiError(409, 'SHELL_JOB_RUNNING', 'mkxp-z installation is in progress')
    try {
      return apiOk(uninstallRgssRuntime())
    } catch (error) {
      return apiBadRequest(error instanceof Error ? error.message : String(error))
    }
  }

  if (findRunningJob('nw-shell') || isShellInstalling()) return shellJobRunning()
  if (!isToolkitShellInstalled()) {
    return apiBadRequest('No shared shell found to uninstall (not installed under data/shell)')
  }
  try {
    const result = uninstallToolkitShell()
    if (result.removed.length === 0) {
      return apiBadRequest('No shared shell available to uninstall')
    }
    return apiOk(result)
  } catch (err) {
    return apiBadRequest(err instanceof Error ? err.message : String(err))
  }
})
