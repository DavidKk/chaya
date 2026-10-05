import fs from 'node:fs'
import path from 'node:path'

import {
  LEGACY_PLUGIN_BOOST_NAMES,
  LEGACY_PLUGIN_EDIT_NAMES,
  LEGACY_PLUGIN_RUNTIME_NAMES,
  LEGACY_PLUGIN_TRANS_NAMES,
  PLUGIN_ENV_NAME,
  PLUGIN_LOADER_NAME,
  PRODUCT_DISPLAY_NAME,
} from '@/constants/brand'
import { PLUGINS_MANIFEST_PATH, ROOT_PATH } from '@/constants/paths'
import {
  gameContentCandidatePaths,
  parsePluginsJs,
  parsePluginsJsEntries,
  type PluginManifestEntry,
  type PluginsJsEntry,
  type PluginStatus,
  serializePluginsJs,
  TRACKED_PLUGINS,
} from '@/lib/game'
import { DIGEST_PLUGIN_NAMES, pluginDigest, pluginsOutdated } from '@/lib/game/plugin-digest'
import { mergeLoaderPluginEntries } from '@/lib/game/plugins-merge'
import { trackedPluginStatuses } from '@/lib/game/plugins-status'

export function loadPluginManifest(): PluginManifestEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(PLUGINS_MANIFEST_PATH, 'utf8')) as {
      plugins?: PluginManifestEntry[]
    }
    return raw.plugins || []
  } catch {
    return []
  }
}

export function resolveKitPluginSource(name: string): string | null {
  const hit = loadPluginManifest().find((p) => p.name === name)
  if (!hit) return null
  const abs = path.join(ROOT_PATH, hit.source)
  return fs.existsSync(abs) ? abs : null
}

/** 去掉 index.html 里已删除的旧翻译加载器 script 标签 */
function stripLegacyIndexScriptTags(contentRoot: string) {
  const indexPath = path.join(contentRoot, 'index.html')
  if (!fs.existsSync(indexPath)) return
  try {
    const raw = fs.readFileSync(indexPath, 'utf8')
    let next = raw
    for (const name of LEGACY_PLUGIN_TRANS_NAMES) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\s*<script\\b[^>]*\\bsrc\\s*=\\s*["'][^"']*${escaped}\\.js["'][^>]*>\\s*</script>`, 'gi')
      next = next.replace(re, '')
    }
    if (next !== raw) fs.writeFileSync(indexPath, next, 'utf8')
  } catch {
    /* */
  }
}

const digestCache = new Map<string, { mtimeMs: number; size: number; digest: string }>()

function fileDigest(file: string): string | null {
  try {
    const st = fs.statSync(file)
    const hit = digestCache.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.digest
    const digest = pluginDigest(fs.readFileSync(file, 'utf8'))
    digestCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, digest })
    return digest
  } catch {
    return null
  }
}

/** Digests of the current plugin build; null when nothing is built */
export function kitPluginDigests(): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const name of DIGEST_PLUGIN_NAMES) {
    const src = resolveKitPluginSource(name)
    const digest = src && fileDigest(src)
    if (digest) out[name] = digest
  }
  return Object.keys(out).length ? out : null
}

/** Whether the game's plugin files differ from the current build */
export function detectPluginsOutdated(contentRoot: string): boolean {
  const pluginsDir = path.join(contentRoot, 'js/plugins')
  const game = Object.fromEntries(DIGEST_PLUGIN_NAMES.map((name) => [name, fileDigest(path.join(pluginsDir, `${name}.js`))]))
  return pluginsOutdated(game, kitPluginDigests())
}

export function detectPlugins(contentRoot: string): PluginStatus[] {
  const pluginsJs = path.join(contentRoot, 'js/plugins.js')
  const pluginsDir = path.join(contentRoot, 'js/plugins')
  const registered = fs.existsSync(pluginsJs) ? parsePluginsJs(fs.readFileSync(pluginsJs, 'utf8')) : []
  const files = new Set([PLUGIN_LOADER_NAME, ...TRACKED_PLUGINS].filter((name) => fs.existsSync(path.join(pluginsDir, `${name}.js`))))
  return trackedPluginStatuses({ registered, files, kitSource: resolveKitPluginSource })
}

export type InjectPluginsResult = {
  mode: 'loader'
  loader: string
  copied: string[]
  registered: string[]
  missingKit: string[]
  pluginsJsUpdated: boolean
  pluginsJsMissing: boolean
  pluginsJsParseFailed: boolean
}

/**
 * 安装 / 更新薄加载器：写入 ChayaLoader + 预热 TRACKED 磁盘缓存，
 * `plugins.js` 只注册 Loader（Env 由 ensureChayaEnvInContent 置顶）。
 * 日常改插件只需 `pnpm build:plugins` 后重启游戏，不必反复注入。
 */
export function injectTrackedPlugins(contentRoot: string): InjectPluginsResult {
  const root = path.resolve(contentRoot)
  const pluginsDir = path.join(root, 'js/plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })

  const copied: string[] = []
  const missingKit: string[] = []

  const loaderSrc = resolveKitPluginSource(PLUGIN_LOADER_NAME)
  if (!loaderSrc) {
    missingKit.push(PLUGIN_LOADER_NAME)
  } else {
    fs.copyFileSync(loaderSrc, path.join(pluginsDir, `${PLUGIN_LOADER_NAME}.js`))
    copied.push(PLUGIN_LOADER_NAME)
  }

  const tracked = new Set<string>(TRACKED_PLUGINS)
  const manifest = loadPluginManifest()
    .filter((p) => tracked.has(p.name))
    .sort((a, b) => a.priority - b.priority)

  for (const plugin of manifest) {
    const src = resolveKitPluginSource(plugin.name)
    if (!src) {
      missingKit.push(plugin.name)
      continue
    }
    fs.copyFileSync(src, path.join(pluginsDir, `${plugin.name}.js`))
    copied.push(plugin.name)
  }

  for (const legacy of [...LEGACY_PLUGIN_RUNTIME_NAMES, ...LEGACY_PLUGIN_TRANS_NAMES, ...LEGACY_PLUGIN_EDIT_NAMES, ...LEGACY_PLUGIN_BOOST_NAMES]) {
    const file = path.join(pluginsDir, `${legacy}.js`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }

  // 旧第三方翻译加载器曾硬编码进 index.html；文件已删会导致脚本 404，顺手清掉
  stripLegacyIndexScriptTags(root)

  const pluginsJs = path.join(root, 'js/plugins.js')
  if (!fs.existsSync(pluginsJs)) {
    return {
      mode: 'loader',
      loader: PLUGIN_LOADER_NAME,
      copied,
      registered: [],
      missingKit,
      pluginsJsUpdated: false,
      pluginsJsMissing: true,
      pluginsJsParseFailed: false,
    }
  }

  if (!loaderSrc) {
    return {
      mode: 'loader',
      loader: PLUGIN_LOADER_NAME,
      copied,
      registered: [],
      missingKit,
      pluginsJsUpdated: false,
      pluginsJsMissing: false,
      pluginsJsParseFailed: false,
    }
  }

  const raw = fs.readFileSync(pluginsJs, 'utf8')
  const parsed = parsePluginsJsEntries(raw)
  if (!parsed) {
    return {
      mode: 'loader',
      loader: PLUGIN_LOADER_NAME,
      copied,
      registered: [],
      missingKit,
      pluginsJsUpdated: false,
      pluginsJsMissing: false,
      pluginsJsParseFailed: true,
    }
  }

  const loaderEntry: PluginsJsEntry = {
    name: PLUGIN_LOADER_NAME,
    status: true,
    description: `${PRODUCT_DISPLAY_NAME} 插件加载器（本机拉取 dist / 磁盘回退）`,
    parameters: {},
  }
  const next = mergeLoaderPluginEntries(parsed.list, loaderEntry)
  const nextRaw = serializePluginsJs(raw, parsed.match, next)
  const pluginsJsUpdated = nextRaw !== raw
  if (pluginsJsUpdated) fs.writeFileSync(pluginsJs, nextRaw, 'utf8')

  return {
    mode: 'loader',
    loader: PLUGIN_LOADER_NAME,
    copied,
    registered: [PLUGIN_LOADER_NAME],
    missingKit,
    pluginsJsUpdated,
    pluginsJsMissing: false,
    pluginsJsParseFailed: false,
  }
}

export type ClearPluginsResult = {
  removedFiles: string[]
  unregistered: string[]
  pluginsJsUpdated: boolean
  pluginsJsMissing: boolean
}

/** 从内容根移除 Loader、跟踪插件缓存与 plugins.js 条目（保留游戏原插件；可选清掉 Env） */
export function clearTrackedPlugins(contentRoot: string, opts?: { alsoEnv?: boolean }): ClearPluginsResult {
  const root = path.resolve(contentRoot)
  const pluginsDir = path.join(root, 'js/plugins')
  const alsoEnv = opts?.alsoEnv !== false
  const names = alsoEnv
    ? [
        PLUGIN_LOADER_NAME,
        ...TRACKED_PLUGINS,
        PLUGIN_ENV_NAME,
        ...LEGACY_PLUGIN_RUNTIME_NAMES,
        ...LEGACY_PLUGIN_TRANS_NAMES,
        ...LEGACY_PLUGIN_EDIT_NAMES,
        ...LEGACY_PLUGIN_BOOST_NAMES,
      ]
    : [PLUGIN_LOADER_NAME, ...TRACKED_PLUGINS, ...LEGACY_PLUGIN_RUNTIME_NAMES, ...LEGACY_PLUGIN_TRANS_NAMES, ...LEGACY_PLUGIN_EDIT_NAMES, ...LEGACY_PLUGIN_BOOST_NAMES]
  const nameSet = new Set<string>(names)

  const removedFiles: string[] = []
  for (const name of names) {
    const file = path.join(pluginsDir, `${name}.js`)
    if (!fs.existsSync(file)) continue
    fs.unlinkSync(file)
    removedFiles.push(name)
  }

  const pluginsJs = path.join(root, 'js/plugins.js')
  if (!fs.existsSync(pluginsJs)) {
    return { removedFiles, unregistered: [], pluginsJsUpdated: false, pluginsJsMissing: true }
  }

  const raw = fs.readFileSync(pluginsJs, 'utf8')
  const parsed = parsePluginsJsEntries(raw)
  if (!parsed) {
    return { removedFiles, unregistered: [], pluginsJsUpdated: false, pluginsJsMissing: false }
  }

  const unregistered = parsed.list.filter((p) => p?.name && nameSet.has(String(p.name))).map((p) => String(p.name))
  const next = parsed.list.filter((p) => !p?.name || !nameSet.has(String(p.name)))
  const nextRaw = serializePluginsJs(raw, parsed.match, next)
  const pluginsJsUpdated = nextRaw !== raw
  if (pluginsJsUpdated) fs.writeFileSync(pluginsJs, nextRaw, 'utf8')

  return { removedFiles, unregistered, pluginsJsUpdated, pluginsJsMissing: false }
}

export function readTranslateSwitches(contentRoot: string): {
  file: string | null
  switches: Record<string, boolean> | null
} {
  const file = gameContentCandidatePaths(contentRoot, 'switches', { alsoParent: true }).find((f) => fs.existsSync(f)) ?? null
  if (!file) return { file: null, switches: null }
  try {
    return {
      file,
      switches: JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8')) as Record<string, boolean>,
    }
  } catch {
    return { file, switches: null }
  }
}

export type { TrackedPlugin } from '@/lib/game'
