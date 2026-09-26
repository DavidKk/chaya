import fs from 'node:fs'
import path from 'node:path'

import { PLUGIN_ENV_NAME, PRODUCT_DISPLAY_NAME } from '@/constants/brand'
import { parsePluginsJsEntries, serializePluginsJs } from '@/lib/game'
import { buildChayaEnvJs } from '@/lib/game/plugins-merge'

export type ChayaEnvOptions = {
  /** 本机启动鉴权；局内心跳携带，用于区分「本机启动」与陌生连接 */
  launchToken?: string
  /** 当前库条目 id（可选，便于局内调试） */
  gameId?: string
}

/**
 * 把 API 根写入内容根，供局内插件（含虚拟机）直连宿主机服务。
 * 生成 `js/plugins/{PLUGIN_ENV_NAME}.js`，并尽量插到 `plugins.js` 最前。
 */
export function ensureChayaEnvInContent(
  contentRoot: string,
  apiBase: string,
  opts?: ChayaEnvOptions
): {
  envFile: string
  pluginsJsUpdated: boolean
} {
  const root = path.resolve(contentRoot)
  const pluginsDir = path.join(root, 'js/plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })

  const envFile = path.join(pluginsDir, `${PLUGIN_ENV_NAME}.js`)
  fs.writeFileSync(envFile, buildChayaEnvJs(apiBase, opts), 'utf8')

  const pluginsJs = path.join(root, 'js/plugins.js')
  if (!fs.existsSync(pluginsJs)) {
    return { envFile, pluginsJsUpdated: false }
  }

  const raw = fs.readFileSync(pluginsJs, 'utf8')
  const parsed = parsePluginsJsEntries(raw)
  if (!parsed) return { envFile, pluginsJsUpdated: false }

  const entry = {
    name: PLUGIN_ENV_NAME,
    status: true,
    description: `${PRODUCT_DISPLAY_NAME} API 根（自动生成，供插件连服务）`,
    parameters: {},
  }
  const without = parsed.list.filter((p) => p && p.name !== PLUGIN_ENV_NAME)
  const next = [entry, ...without]
  const nextRaw = serializePluginsJs(raw, parsed.match, next)
  if (nextRaw !== raw) fs.writeFileSync(pluginsJs, nextRaw, 'utf8')
  return { envFile, pluginsJsUpdated: nextRaw !== raw || !parsed.list.some((p) => p?.name === PLUGIN_ENV_NAME) }
}
