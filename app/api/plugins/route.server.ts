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
    return apiBadRequest(resolved.error || 'No game bound yet')
  }
  if (resolved.remote) {
    return apiBadRequest('Remote game cannot install loader locally', 'REMOTE_READ_ONLY')
  }

  try {
    const apiBase = preferredPluginApiBase(toolkitListenPort())
    const result = injectTrackedPlugins(resolved.contentRoot)
    if (result.missingKit.includes(PLUGIN_LOADER_NAME) || (result.missingKit.length && result.copied.length === 0)) {
      return apiBadRequest(`Missing plugin build artifacts: ${result.missingKit.join('、')} (run pnpm build:plugins first)`, 'PLUGINS_MISSING')
    }
    if (result.pluginsJsMissing) {
      return apiBadRequest(`Missing js/plugins.js in content root: ${resolved.contentRoot}`)
    }
    if (result.pluginsJsParseFailed) {
      return apiError(500, 'PLUGINS_JS_PARSE_FAILED', `Failed to parse js/plugins.js ($plugins array format invalid): ${resolved.contentRoot}`)
    }
    const { env, session } = writeLaunchEnv(resolved, apiBase)
    return apiOk({
      contentRoot: resolved.contentRoot,
      apiBase,
      env,
      launchToken: session.token,
      launchTokenPersistence: session.persistence,
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
    return apiBadRequest(resolved.error || 'No game bound yet')
  }
  if (resolved.remote) {
    return apiBadRequest('Remote game cannot clear loader locally', 'REMOTE_READ_ONLY')
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
