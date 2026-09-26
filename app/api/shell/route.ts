import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, installShell, isToolkitShellInstalled, requireDisk, saveConfig, uninstallToolkitShell } from '@/services/disk-ops'
import { ensureLatestNwShellSource } from '@/services/game/nw-download'
import { getNwShellUpdate } from '@/services/game/nw-update'

export const runtime = 'nodejs'
/** 官方包约百兆级，给下载+解压留足时间（自托管 Node 忽略亦可） */
export const maxDuration = 600

export const GET = defineApiRoute('get:/api/shell', async () => {
  const denied = requireDisk()
  if (denied) return denied
  const resolved = getResolvedFromConfig()
  if (!resolved.ok || resolved.remote || resolved.bundled || !resolved.hasShell) return apiOk({ available: false })
  return apiOk(await getNwShellUpdate(resolved.shellApp))
})

export const POST = defineApiRoute('post:/api/shell', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    shellSource?: string
    /** 从 nwjs.io 拉取当前平台最新包并强制装入 data/shell */
    fetchLatest?: boolean
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
      const dl = await ensureLatestNwShellSource()
      const result = installShell({
        shellSource: dl.shellSource,
        contentRoot: resolved.contentRoot,
        force: true,
      })
      const config = saveConfig({ shellSource: dl.shellSource })
      return apiOk({
        ...result,
        config,
        nw: {
          version: dl.version,
          fileKey: dl.fileKey,
          chromium: dl.chromium,
          downloaded: dl.downloaded,
          shellSource: dl.shellSource,
        },
      })
    }

    const shellSource = String(body.shellSource || resolved.config.shellSource || '').trim()
    if (!shellSource) {
      return apiBadRequest('请先填写干净的 NW.js 壳源路径（shellSource），或使用「下载最新壳」')
    }

    const result = installShell({
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
