import {
  buildPluginInfo,
  detectEngine,
  ENGINE_CORE_CANDIDATES,
  type EngineLib,
  type GameFingerprintSummary,
  parseCoreScript,
  parseLibVersion,
  parseSystemJson,
  PLUGIN_SOURCE_READ_BYTES,
  pluginStats,
  summarizeFingerprint,
} from '@/lib/game/fingerprint'
import { parsePluginsJsEntries } from '@/lib/game/plugins-parse'

import { dirExists, getDir } from './fsa'

/** 读取上限与 services/game/fingerprint.ts 一致 */
const CORE_READ_BYTES = 512 * 1024
const LIB_HEAD_BYTES = 1024
const MAX_BUNDLED_SCRIPT_PROBES = 6

type IterableDir = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }

async function subDir(parent: FileSystemDirectoryHandle | null, name: string): Promise<FileSystemDirectoryHandle | null> {
  return parent && (await dirExists(parent, name)) ? getDir(parent, name) : null
}

async function readHead(dir: FileSystemDirectoryHandle | null, name: string, bytes: number): Promise<string | null> {
  if (!dir) return null
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).slice(0, bytes).text()
  } catch {
    return null
  }
}

async function listJsFiles(dir: FileSystemDirectoryHandle | null): Promise<string[]> {
  if (!dir) return []
  const names: string[] = []
  for await (const handle of (dir as IterableDir).values()) {
    if (handle.kind === 'file' && handle.name.endsWith('.js')) names.push(handle.name)
  }
  return names.sort()
}

async function collectEngine(js: FileSystemDirectoryHandle | null) {
  const jsFiles = await listJsFiles(js)
  const libsDir = await subDir(js, 'libs')
  const libs: EngineLib[] = []
  for (const name of await listJsFiles(libsDir)) libs.push({ name, version: parseLibVersion((await readHead(libsDir, name, LIB_HEAD_BYTES)) ?? '') })
  let coreSource: string | null = null
  const core = ENGINE_CORE_CANDIDATES.find((file) => jsFiles.includes(file))
  if (core) coreSource = await readHead(js, core, CORE_READ_BYTES)
  if (!coreSource) {
    for (const file of jsFiles.filter((f) => f !== 'plugins.js').slice(0, MAX_BUNDLED_SCRIPT_PROBES)) {
      const source = await readHead(js, file, CORE_READ_BYTES)
      if (source && parseCoreScript(source).source !== 'none') {
        coreSource = source
        break
      }
    }
  }
  return detectEngine({ jsFiles, coreSource, libs })
}

/** 游戏库摘要（引擎 / 第三方插件数 / 是否加密），口径同 services/game/fingerprint.ts */
export async function collectCloudFingerprint(content: FileSystemDirectoryHandle): Promise<GameFingerprintSummary | undefined> {
  try {
    const js = await subDir(content, 'js')
    const pluginsDir = await subDir(js, 'plugins')
    const raw = await readHead(js, 'plugins.js', Number.MAX_SAFE_INTEGER)
    const entries = (raw ? parsePluginsJsEntries(raw)?.list : undefined) ?? []
    const plugins = []
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) continue
      plugins.push(buildPluginInfo(entry, await readHead(pluginsDir, `${entry.name}.js`, PLUGIN_SOURCE_READ_BYTES)))
    }
    const systemRaw = await readHead(await subDir(content, 'data'), 'System.json', Number.MAX_SAFE_INTEGER)
    let system = null
    try {
      system = systemRaw ? parseSystemJson(JSON.parse(systemRaw.replace(/^\uFEFF/, ''))) : null
    } catch {
      system = null
    }
    return summarizeFingerprint({ engine: await collectEngine(js), system, package: null, shells: [], plugins, pluginStats: pluginStats(plugins), collectedAt: Date.now() })
  } catch {
    return undefined
  }
}
