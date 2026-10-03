import { PLUGIN_LOADER_NAME } from '@/constants/brand'
import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { clearTrackedPlugins, getResolvedFromConfig, injectTrackedPlugins, requireDisk } from '@/services/disk-ops'
import { preferredPluginApiBase, toolkitListenPort, writeLaunchEnv } from '@/services/runtime'

export const runtime = 'nodejs'

/** 安装 / 更新 ChayaLoader + 磁盘缓存，并写入 Env（含 launchToken） */
export const POST = defineApiRoute('post:/api/plugins', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error || '尚未绑定游戏')
  }
  if (resolved.remote) {
    return apiBadRequest('远程连接的游戏无法在本机安装 Loader', 'REMOTE_READ_ONLY')
  }

  try {
    const apiBase = preferredPluginApiBase(toolkitListenPort())
    const result = injectTrackedPlugins(resolved.contentRoot)
    if (result.missingKit.includes(PLUGIN_LOADER_NAME) || (result.missingKit.length && result.copied.length === 0)) {
      return apiBadRequest(`缺少插件构建产物：${result.missingKit.join('、')}（请先 pnpm build:plugins）`, 'PLUGINS_MISSING')
    }
    if (result.pluginsJsMissing) {
      return apiBadRequest(`内容根缺少 js/plugins.js：${resolved.contentRoot}`)
    }
    if (result.pluginsJsParseFailed) {
      return apiError(500, 'PLUGINS_JS_PARSE_FAILED', `无法解析 js/plugins.js（$plugins 数组格式异常）：${resolved.contentRoot}`)
    }
    const { env, session } = writeLaunchEnv(resolved, apiBase)
    return apiOk({
      contentRoot: resolved.contentRoot,
      apiBase,
      env,
      launchToken: session.token,
      ...result,
    })
  } catch (err) {
    return apiError(500, 'PLUGIN_INJECT_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 清除 Loader、跟踪插件缓存与 Env */
export const DELETE = defineApiRoute('delete:/api/plugins', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error || '尚未绑定游戏')
  }
  if (resolved.remote) {
    return apiBadRequest('远程连接的游戏无法在本机清除 Loader', 'REMOTE_READ_ONLY')
  }

  try {
    const result = clearTrackedPlugins(resolved.contentRoot)
    return apiOk({
      contentRoot: resolved.contentRoot,
      ...result,
    })
  } catch (err) {
    return apiError(500, 'PLUGIN_CLEAR_FAILED', err instanceof Error ? err.message : String(err))
  }
})
