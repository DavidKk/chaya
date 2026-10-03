import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import {
  ensureNwPackageName,
  ensureShellLinkedToContent,
  getResolvedFromConfig,
  injectTrackedPlugins,
  launchShellWithContent,
  openInFinder,
  recoverOldIfNeeded,
  requireDisk,
} from '@/services/disk-ops'
import { anyWebConnected, clearGameQuitRequest, getGamePresence, preferredPluginApiBase, requestGameQuit, toolkitListenPort, writeLaunchEnv } from '@/services/runtime'

export const runtime = 'nodejs'

/** 启动：确保 Loader + Env（含 launchToken）+ 磁盘缓存，再 open / 传参启动 */
export const POST = defineApiRoute('post:/api/launch', async () => {
  const denied = requireDisk()
  if (denied) return denied

  if (anyWebConnected()) {
    return apiBadRequest('游戏已在运行（WebRTC 已连接），请勿重复启动', 'ALREADY_RUNNING')
  }
  clearGameQuitRequest()

  try {
    recoverOldIfNeeded()
  } catch (err) {
    return apiError(500, 'SHELL_SWAP_RECOVERY_REQUIRED', err instanceof Error ? err.message : String(err))
  }
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error || '尚未绑定游戏')
  }
  if (!resolved.hasShell) {
    return apiBadRequest('尚未安装壳，无法启动')
  }
  if (resolved.remote) {
    return apiBadRequest('远程连接的游戏无法从本机启动', 'REMOTE_READ_ONLY')
  }

  try {
    // 部分 Windows 发布包 package.json name 为空，NW.js 会直接拒启
    const nwPackage = ensureNwPackageName(resolved.contentRoot)
    const apiBase = preferredPluginApiBase(toolkitListenPort())
    const plugins = injectTrackedPlugins(resolved.contentRoot)
    if (plugins.missingKit.length && plugins.copied.length === 0) {
      return apiBadRequest(`缺少插件构建产物：${plugins.missingKit.join('、')}（请先 pnpm build:plugins）`, 'PLUGINS_MISSING')
    }
    if (plugins.pluginsJsMissing) {
      return apiBadRequest(`内容根缺少 js/plugins.js：${resolved.contentRoot}`)
    }
    if (plugins.pluginsJsParseFailed) {
      return apiError(500, 'PLUGINS_JS_PARSE_FAILED', `无法解析 js/plugins.js（$plugins 数组格式异常）：${resolved.contentRoot}`)
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
        plugins,
        nwPackage,
      })
    }

    ensureShellLinkedToContent({
      shellApp: resolved.shellApp,
      contentRoot: resolved.contentRoot,
    })
    await launchShellWithContent(resolved.shellApp, resolved.contentRoot)
    return apiOk({
      path: resolved.shellApp,
      contentRoot: resolved.contentRoot,
      mode: 'shared-shell',
      apiBase,
      env,
      launchToken: session.token,
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
    return apiBadRequest('当前没有在线的游戏会话', 'NOT_RUNNING')
  }
  const next = requestGameQuit()
  return apiOk({ quit: true, presence: next })
})
