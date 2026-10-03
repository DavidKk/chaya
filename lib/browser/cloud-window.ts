import { mergeNwPackageWindow, normalizeWindow, type NwWindowConfig, sanitizeNwPackageName } from '@/lib/game/nw-window'

import { readTextFile, writeTextFile } from './fsa'

export type CloudNwPackage = { name: string; window: NwWindowConfig }

async function readPackageJson(content: FileSystemDirectoryHandle): Promise<Record<string, unknown> | null> {
  const text = await readTextFile(content, 'package.json')
  if (text == null) return null
  try {
    const raw: unknown = JSON.parse(text)
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 内容根下的 NW package.json（与服务端 readNwPackage 同一位置）；缺失或无法解析时为 null */
export async function readCloudNwPackage(content: FileSystemDirectoryHandle): Promise<CloudNwPackage | null> {
  const raw = await readPackageJson(content)
  return raw ? { name: String(raw.name || ''), window: normalizeWindow(raw.window) } : null
}

/** 只改已有的 package.json：浏览器侧不凭空生成 NW 配置 */
export async function writeCloudWindow(content: FileSystemDirectoryHandle, partial: Partial<NwWindowConfig>, folderName: string): Promise<CloudNwPackage> {
  const raw = await readPackageJson(content)
  if (!raw) throw new Error('游戏目录缺少可解析的 package.json，无法修改窗口设置')
  const fallbackName = sanitizeNwPackageName(normalizeWindow(raw.window).title || folderName)
  const next = mergeNwPackageWindow(raw, partial, fallbackName)
  await writeTextFile(content, 'package.json', `${JSON.stringify(next, null, 2)}\n`)
  return { name: String(next.name), window: next.window as NwWindowConfig }
}
