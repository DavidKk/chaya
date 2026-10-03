import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiNotFound, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, type NwWindowConfig, pathEquals, readNwPackage, requireDisk, writeNwWindow } from '@/services/disk-ops'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/window', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }
  if (resolved.remote) {
    return apiBadRequest('远程连接的游戏无法读取本机窗口配置', 'REMOTE_READ_ONLY')
  }
  const pkg = readNwPackage(resolved.contentRoot)
  if (!pkg) {
    return apiNotFound(`内容根缺少 package.json: ${resolved.contentRoot}`)
  }
  return apiOk({ package: pkg })
})

export const PUT = defineApiRoute('put:/api/window', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }
  if (resolved.remote) {
    return apiBadRequest('远程连接的游戏无法修改本机窗口配置', 'REMOTE_READ_ONLY')
  }

  const body = (await request.json().catch(() => ({}))) as {
    window?: Partial<NwWindowConfig>
    gameRoot?: string
  }
  if (body.gameRoot && !pathEquals(body.gameRoot, resolved.selected)) {
    return apiError(409, 'GAME_CHANGED', '选中的游戏已变化，请重新保存')
  }
  if (!body.window || typeof body.window !== 'object') {
    return apiBadRequest('缺少 window 对象')
  }

  try {
    const pkg = writeNwWindow(resolved.contentRoot, body.window)
    return apiOk({ package: pkg })
  } catch (err) {
    return apiError(500, 'WINDOW_WRITE_FAILED', err instanceof Error ? err.message : String(err))
  }
})
