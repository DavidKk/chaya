/**
 * NW.js 官方包元数据（纯函数，无 I/O）。
 * 版本清单：https://nwjs.io/versions.json
 * 下载：https://dl.nwjs.io/{version}/nwjs-{version}-{file}.zip|.tar.gz
 */

export type NwHostPlatform = 'win32' | 'darwin' | 'linux'
export type NwFlavor = 'normal' | 'sdk'

/** versions.json 里的 files 项，如 win-x64 / osx-arm64 */
export function nwFileKey(platform: NwHostPlatform | NodeJS.Platform, arch: string = process.arch): string {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'osx' : platform === 'linux' ? 'linux' : null
  if (!os) throw new Error(`不支持的平台: ${platform}`)

  let cpu: string
  if (arch === 'arm64') cpu = 'arm64'
  else if (arch === 'x64' || arch === 'x86_64') cpu = 'x64'
  else if (arch === 'ia32' || arch === 'x86') cpu = 'ia32'
  else throw new Error(`不支持的 CPU 架构: ${arch}`)

  if (cpu === 'ia32' && os !== 'win') {
    throw new Error(`平台 ${os} 不提供 ia32 包`)
  }
  return `${os}-${cpu}`
}

export function nwArchiveName(version: string, fileKey: string, flavor: NwFlavor = 'normal'): string {
  const ver = version.startsWith('v') ? version : `v${version}`
  const prefix = flavor === 'sdk' ? 'nwjs-sdk' : 'nwjs'
  const ext = fileKey.startsWith('linux-') ? 'tar.gz' : 'zip'
  return `${prefix}-${ver}-${fileKey}.${ext}`
}

export function nwDownloadUrl(version: string, fileKey: string, flavor: NwFlavor = 'normal'): string {
  const ver = version.startsWith('v') ? version : `v${version}`
  return `https://dl.nwjs.io/${ver}/${nwArchiveName(ver, fileKey, flavor)}`
}

export function normalizeNwVersion(version: string): string {
  const t = version.trim()
  if (!t) throw new Error('版本号为空')
  return t.startsWith('v') ? t : `v${t}`
}
