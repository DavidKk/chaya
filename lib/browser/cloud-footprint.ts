import { PLUGIN_LOADER_NAME } from '@/constants/brand'
import { gameContentRelPath, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'
import { parsePluginsJs } from '@/lib/game/plugins-parse'
import { trackedPluginStatuses } from '@/lib/game/plugins-status'
import { type PluginStatus, TRACKED_PLUGINS } from '@/lib/game/types'

import { dirExists, fileExists, getDir, readTextFile } from './fsa'

/** 与服务端 status 同口径的浏览器侧统计（FSA 只读） */
export type CloudFootprint = { contentBytes: number | null; shellBytes: number | null }

type IterableDir = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }

/** 递归累加文件大小；浏览器只能拿到逻辑大小，与服务端 `du` 的占盘值略有出入 */
export async function measureCloudDirBytes(dir: FileSystemDirectoryHandle): Promise<number | null> {
  try {
    let total = 0
    for await (const handle of (dir as IterableDir).values()) {
      if (handle.kind === 'file') total += (await (handle as FileSystemFileHandle).getFile()).size
      else total += (await measureCloudDirBytes(handle as FileSystemDirectoryHandle)) ?? 0
    }
    return total
  } catch {
    return null
  }
}

async function findDir(roots: FileSystemDirectoryHandle[], name: string): Promise<FileSystemDirectoryHandle | null> {
  for (const root of roots) {
    if (await dirExists(root, name)) return getDir(root, name)
  }
  return null
}

export async function measureCloudFootprint(picked: FileSystemDirectoryHandle, content: FileSystemDirectoryHandle, shellName?: string): Promise<CloudFootprint> {
  const shellDir = shellName ? await findDir(picked === content ? [picked] : [picked, content], shellName) : null
  const [contentBytes, shellBytes] = await Promise.all([measureCloudDirBytes(content), shellDir ? measureCloudDirBytes(shellDir) : Promise.resolve(null)])
  return { contentBytes, shellBytes }
}

/** 同 services/game/plugins.ts detectPlugins */
export async function detectCloudPlugins(content: FileSystemDirectoryHandle): Promise<PluginStatus[]> {
  const js = (await dirExists(content, 'js')) ? await getDir(content, 'js') : null
  const raw = js ? await readTextFile(js, 'plugins.js') : null
  const registered = raw ? parsePluginsJs(raw) : []
  const pluginsDir = js && (await dirExists(js, 'plugins')) ? await getDir(js, 'plugins') : null
  const files = new Set<string>()
  if (pluginsDir) {
    for (const name of [PLUGIN_LOADER_NAME, ...TRACKED_PLUGINS]) {
      if (await fileExists(pluginsDir, `${name}.js`)) files.add(name)
    }
  }
  return trackedPluginStatuses({ registered, files })
}

async function countLines(file: File): Promise<number> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader()
  let entries = 0
  let remainder = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = (remainder + value).split('\n')
    remainder = lines.pop() || ''
    for (const line of lines) if (line.trim()) entries++
  }
  return remainder.trim() ? entries + 1 : entries
}

async function readFileAt(root: FileSystemDirectoryHandle, rel: string): Promise<File | null> {
  try {
    const parts = rel.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
    return await (await dir.getFileHandle(parts[parts.length - 1])).getFile()
  } catch {
    return null
  }
}

/** 游戏侧译文缓存条数：候选路径与服务端 gameCacheFileStats 一致（内容根优先，再看上一级） */
export async function countCloudCacheEntries(picked: FileSystemDirectoryHandle, content: FileSystemDirectoryHandle): Promise<number> {
  const rels = [gameContentRelPath('cacheNdjson'), ...LEGACY_FLAT_FILES.cacheNdjson]
  for (const root of picked === content ? [content] : [content, picked]) {
    for (const rel of rels) {
      const file = await readFileAt(root, rel)
      if (file) return countLines(file).catch(() => 0)
    }
  }
  return 0
}
