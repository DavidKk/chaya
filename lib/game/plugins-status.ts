import { PLUGIN_LOADER_NAME } from '@/constants/brand'

import { type PluginStatus, TRACKED_PLUGINS, type TrackedPlugin } from './types'

/**
 * 跟踪插件状态（server fs / 浏览器 FSA 共用判定）：
 * Loader 文件在且已注册启用时，视为全部跟踪插件已挂上；否则逐个看注册与 `js/plugins/<name>.js`。
 */
export function trackedPluginStatuses(input: {
  registered: ReadonlyArray<{ name: string; status: boolean }>
  /** `js/plugins/` 下存在的插件名（不含 .js） */
  files: ReadonlySet<string>
  kitSource?: (name: TrackedPlugin) => string | null
}): PluginStatus[] {
  const byName = new Map(input.registered.map((p) => [p.name, p]))
  const loader = byName.get(PLUGIN_LOADER_NAME)
  const viaLoader = input.files.has(PLUGIN_LOADER_NAME) && !!loader && loader.status !== false
  return TRACKED_PLUGINS.map((name) => {
    const hit = byName.get(name)
    return {
      name,
      registered: viaLoader || !!hit,
      enabled: viaLoader || !!hit?.status,
      fileExists: viaLoader || input.files.has(name),
      kitSource: input.kitSource?.(name) ?? null,
    }
  })
}

export function countReadyPlugins(plugins: readonly PluginStatus[]): number {
  return plugins.filter((p) => p.fileExists && p.registered).length
}
