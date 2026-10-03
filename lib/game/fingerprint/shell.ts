/** 壳版本解析：只依赖读字节 / 文本的回调，Node 与浏览器都可复用。 */

export type ReadAt = (offset: number, length: number) => Uint8Array

const CHROMIUM_RE = /^\d+\.\d+\.\d+\.\d+$/
/** 图标多的 exe 资源段可达数 MB；版本信息通常在段尾，整段读入后搜索 */
const MAX_RSRC_BYTES = 16 * 1024 * 1024

export function isChromiumVersion(value: string | null | undefined): value is string {
  return !!value && CHROMIUM_RE.test(value)
}

/** `nwjs Framework.framework/Versions/` 的子目录名就是 Chromium 版本 */
export function chromiumFromFrameworkVersions(names: readonly string[]): string | null {
  return names.find((name) => CHROMIUM_RE.test(name)) ?? null
}

/** XML plist 的字符串值；二进制 plist 返回 null */
export function plistString(xml: string, key: string): string | null {
  if (xml.startsWith('bplist')) return null
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1]?.trim() || null
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
}

function utf16Key(key: string): Uint8Array {
  const out = new Uint8Array((key.length + 1) * 2)
  for (let i = 0; i < key.length; i += 1) out[i * 2] = key.charCodeAt(i)
  return out
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 2) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

function readVersionString(rsrc: Uint8Array, key: string): string | null {
  const at = indexOf(rsrc, utf16Key(key))
  if (at < 0) return null
  let cursor = at + (key.length + 1) * 2
  while (cursor < rsrc.length - 1 && u16(rsrc, cursor) === 0) cursor += 2
  let value = ''
  for (; cursor < rsrc.length - 1 && value.length < 64; cursor += 2) {
    const code = u16(rsrc, cursor)
    if (code === 0) break
    value += String.fromCharCode(code)
  }
  return value.trim().replace(/,\s*/g, '.') || null
}

/** Windows exe 的 VS_VERSION_INFO：NW.js 壳的 ProductVersion 是 Chromium 版本 */
export function readPeVersion(readAt: ReadAt): { productVersion: string | null; fileVersion: string | null } | null {
  const dos = readAt(0, 64)
  if (dos.length < 64 || dos[0] !== 0x4d || dos[1] !== 0x5a) return null
  const peOffset = u32(dos, 0x3c)
  const coff = readAt(peOffset, 24)
  if (coff.length < 24 || u32(coff, 0) !== 0x00004550) return null
  const sectionCount = u16(coff, 6)
  const optionalSize = u16(coff, 20)
  const sections = readAt(peOffset + 24 + optionalSize, sectionCount * 40)
  for (let i = 0; i < sectionCount; i += 1) {
    const base = i * 40
    if (base + 40 > sections.length) break
    const name = String.fromCharCode(...sections.subarray(base, base + 8)).replace(/\0+$/, '')
    if (name !== '.rsrc') continue
    const size = Math.min(u32(sections, base + 16), MAX_RSRC_BYTES)
    const rsrc = readAt(u32(sections, base + 20), size)
    return { productVersion: readVersionString(rsrc, 'ProductVersion'), fileVersion: readVersionString(rsrc, 'FileVersion') }
  }
  return null
}
