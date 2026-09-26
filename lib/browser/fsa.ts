/** 浏览器 File System Access：仅 Chromium（Chrome / Edge）+ 安全上下文 */

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>
  }

export function supportsDirectoryPicker(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
}

export function isLikelyChromium(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Chrome / Edge / Opera / Chromium；排除旧 EdgeHTML
  return (/Chrome|Chromium|Edg\//.test(ua) || /OPR\//.test(ua)) && !/EdgA|EdgiOS/.test(ua)
}

/** `http://192.168.x.x` 等局域网明文不是安全上下文，FSA 不可用 */
export function isSecureContextForFsa(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

export type FsaSupportReason = 'not-chromium' | 'insecure-origin' | 'no-picker'

export type FsaSupport = {
  ok: boolean
  reason?: FsaSupportReason
}

export function getFsaSupport(): FsaSupport {
  // 先判安全上下文：局域网 http://192.168.x.x 在 Chrome 下也会关掉 FSA
  if (typeof window !== 'undefined' && !isSecureContextForFsa()) {
    return { ok: false, reason: 'insecure-origin' }
  }
  if (!isLikelyChromium()) return { ok: false, reason: 'not-chromium' }
  if (!supportsDirectoryPicker()) return { ok: false, reason: 'no-picker' }
  return { ok: true }
}

export async function pickDirectory(opts?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle> {
  const w = window as DirectoryPickerWindow
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('当前环境无法选择本地文件夹（需 Chrome / Edge，且用 https 或 127.0.0.1 打开）')
  }
  return w.showDirectoryPicker({
    mode: opts?.mode ?? 'readwrite',
    id: opts?.id,
  })
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
  throw new Error('未识别为 RPG Maker 内容根：请选择含 index.html 与 js/ 的目录，或含 www/ 的发布根')
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
