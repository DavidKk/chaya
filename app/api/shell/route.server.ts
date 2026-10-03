import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, installShell, isShellInstalling, isToolkitShellInstalled, requireDisk, saveConfig, uninstallToolkitShell } from '@/services/disk-ops'
import { findRunningJob } from '@/services/downloads/jobs'
import { getNwShellUpdate } from '@/services/game/nw-update'
import { startLatestShellJob } from '@/services/game/shell-job'

export const runtime = 'nodejs'
/** `wait` 时同步等待下载；Hobby 上限 300s（自托管忽略） */
export const maxDuration = 300

export const GET = defineApiRoute('get:/api/shell', async () => {
  const denied = requireDisk()
  if (denied) return denied
  const resolved = getResolvedFromConfig()
  if (!resolved.ok || resolved.remote || resolved.bundled || !resolved.hasShell) return apiOk({ available: false })
  return apiOk(await getNwShellUpdate(resolved.shellApp))
})

function shellJobRunning() {
  return apiError(409, 'SHELL_JOB_RUNNING', '正在下载安装 NW.js，请等下载中心里的任务结束后再操作')
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
    return apiBadRequest('远程连接的游戏无法在本机装壳', 'REMOTE_READ_ONLY')
  }

  try {
    if (body.fetchLatest) {
      const { job, done, reused } = startLatestShellJob(resolved.contentRoot)
      if (!body.wait) return apiOk({ job, reused }, { status: 202 })
      const finished = await done
      if (finished.status !== 'done') return apiBadRequest(finished.error || '下载已取消')
      return apiOk({ ...finished.result, job: finished })
    }

    if (findRunningJob('nw-shell')) return shellJobRunning()
    const shellSource = String(body.shellSource || resolved.config.shellSource || '').trim()
    if (!shellSource) {
      return apiBadRequest('请先填写干净的 NW.js 壳源路径（shellSource），或使用「下载最新壳」')
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

  if (findRunningJob('nw-shell') || isShellInstalling()) return shellJobRunning()
  if (!isToolkitShellInstalled()) {
    return apiBadRequest('没有可卸载的共用壳（工具 data/shell 下未安装）')
  }
  try {
    const result = uninstallToolkitShell()
    if (result.removed.length === 0) {
      return apiBadRequest('没有可卸载的共用壳')
    }
    return apiOk(result)
  } catch (err) {
    return apiBadRequest(err instanceof Error ? err.message : String(err))
  }
})
