/** 浏览器 File System Access：按实际能力检测，不依赖 UA。 */

import { detectUnsupportedEngine, type UnsupportedEngine, UnsupportedEngineError } from '@/lib/game/unsupported-engine'

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>
  }

export type DirectoryCapability = { state: 'available' } | { state: 'insecure' } | { state: 'unsupported' } | { state: 'blocked'; reason: string }

export function detectDirectoryCapability(input: { secure: boolean; hasPicker: boolean }): DirectoryCapability {
  if (!input.secure) return { state: 'insecure' }
  if (!input.hasPicker) return { state: 'unsupported' }
  return { state: 'available' }
}

export function getDirectoryCapability(): DirectoryCapability {
  if (typeof window === 'undefined') return { state: 'unsupported' }
  return detectDirectoryCapability({
    secure: window.isSecureContext,
    hasPicker: typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function',
  })
}

export class DirectoryAccessBlockedError extends Error {
  readonly capability: DirectoryCapability = { state: 'blocked', reason: '当前页面环境禁止访问本地目录，请在独立标签页直接打开 Chaya' }

  constructor() {
    super('当前页面环境禁止访问本地目录，请在独立标签页直接打开 Chaya')
    this.name = 'DirectoryAccessBlockedError'
  }
}

export async function pickDirectory(opts?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle> {
  const w = window as DirectoryPickerWindow
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('当前环境无法选择本地文件夹（需 Chrome / Microsoft Edge，且用 https 或 127.0.0.1 打开）')
  }
  try {
    return await w.showDirectoryPicker({
      mode: opts?.mode ?? 'readwrite',
      id: opts?.id,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') throw new DirectoryAccessBlockedError()
    throw error
  }
}

export async function getDir(parent: FileSystemDirectoryHandle, name: string, create = false): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create })
}

export async function writeTextFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(text)
  await writable.close()
}

export async function writeBytesFile(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  await writable.write(copy)
  await writable.close()
}

export async function readTextFile(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const file = await dir.getFileHandle(name)
    const blob = await file.getFile()
    return await blob.text()
  } catch {
    return null
  }
}

export async function dirExists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name)
    return true
  } catch {
    return false
  }
}

export async function fileExists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** 已有文件字节数；不存在返回 null */
export async function fileByteLength(parent: FileSystemDirectoryHandle, name: string): Promise<number | null> {
  try {
    const handle = await parent.getFileHandle(name)
    const file = await handle.getFile()
    return file.size
  } catch {
    return null
  }
}

/** 沿路径创建子目录（如 js/plugins） */
export async function ensurePath(root: FileSystemDirectoryHandle, parts: string[]): Promise<FileSystemDirectoryHandle> {
  let cur = root
  for (const part of parts) {
    if (!part || part === '.') continue
    cur = await getDir(cur, part, true)
  }
  return cur
}

/** 探测内容根：自身或 www/ 子目录含 index.html + js/ */
export async function resolveContentRootHandle(picked: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  if (await looksLikeContentRoot(picked)) return picked
  if (await dirExists(picked, 'www')) {
    const www = await getDir(picked, 'www')
    if (await looksLikeContentRoot(www)) return www
  }
  const engine = await detectUnsupportedEngineInDir(picked)
  if (engine) throw new UnsupportedEngineError(engine)
  throw new Error('未识别为 RPG Maker 内容根：请选择含 index.html 与 js/ 的目录，或含 www/ 的发布根')
}

type IterableDir = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }

async function listNames(dir: FileSystemDirectoryHandle): Promise<FileSystemHandle[]> {
  const handles: FileSystemHandle[] = []
  try {
    for await (const handle of (dir as IterableDir).values()) handles.push(handle)
  } catch {
    /* Treat as an empty directory when read permission is missing */
  }
  return handles
}

async function detectUnsupportedEngineInDir(dir: FileSystemDirectoryHandle): Promise<UnsupportedEngine | null> {
  const root = await listNames(dir)
  const sub = async (name: string) => {
    const hit = root.find((handle) => handle.kind === 'directory' && handle.name.toLowerCase() === name)
    return hit ? (await listNames(hit as FileSystemDirectoryHandle)).map((handle) => handle.name) : []
  }
  return detectUnsupportedEngine({ root: root.map((handle) => handle.name), data: await sub('data'), system: await sub('system') })
}

async function looksLikeContentRoot(dir: FileSystemDirectoryHandle): Promise<boolean> {
  return (await fileExists(dir, 'index.html')) && (await dirExists(dir, 'js'))
}

/** 客户端平台粗判（装壳用） */
export function detectClientOs(): 'win' | 'mac' | 'linux' | 'other' {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'win'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'
  if (/Linux/i.test(ua)) return 'linux'
  return 'other'
}

export function detectClientArch(): 'x64' | 'arm64' | 'ia32' {
  if (typeof navigator === 'undefined') return 'x64'
  const ua = navigator.userAgent
  if (/arm64|aarch64/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    // Apple Silicon 常报 MacIntel；用 maxTouchPoints 启发式不够稳，优先 userAgentData
  }
  const uaData = (navigator as Navigator & { userAgentData?: { architecture?: string; platform?: string } }).userAgentData
  if (uaData?.architecture === 'arm') return 'arm64'
  if (/arm64|aarch64/i.test(ua)) return 'arm64'
  if (/WOW64|Win64|x64|amd64/i.test(ua)) return 'x64'
  if (/i[3-6]86|ia32/i.test(ua)) return 'ia32'
  // mac Apple Silicon：platform 仍可能是 MacIntel
  if (/Mac/i.test(ua) && typeof navigator.hardwareConcurrency === 'number') {
    // 无法可靠区分；默认 arm64（近年 Mac）在 mac 上更常见，失败再让用户手动下 x64
  }
  if (/Mac/i.test(navigator.platform || ua)) return 'arm64'
  return 'x64'
}
