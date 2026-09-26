import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { nwFileKey } from '@/lib/game/nw-download-meta'

import { fetchVersionsJson, type VersionsJson } from './nw-download'

const execFileAsync = promisify(execFile)
let releases: { until: number; request: Promise<VersionsJson> } | null = null

function getReleases() {
  if (releases && releases.until > Date.now()) return releases.request
  const entry = { until: Date.now() + 30 * 60_000, request: fetchVersionsJson() }
  releases = entry
  void entry.request.catch(() => {
    if (releases === entry) entry.until = Date.now() + 60_000
  })
  return entry.request
}

function parseVersion(version: string): number[] | null {
  return /^\d+\.\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null
}

/** 用实际壳的 Chromium 元数据判断；无法证明比当前更新时不展示升级。 */
export function assessNwShellUpdate(currentChromium: string, versions: VersionsJson, fileKey: string) {
  const latestVersion = versions.stable || versions.latest
  const target = versions.versions?.find((item) => item.version === latestVersion)
  const latestChromium = target?.components?.chromium || ''
  const current = parseVersion(currentChromium)
  const latest = parseVersion(latestChromium)
  const difference = current && latest ? latest.map((part, index) => part - current[index]).find((part) => part !== 0) : undefined
  const supported = target?.files?.includes(fileKey) && (!target.flavors || target.flavors.includes('normal'))
  return { available: Boolean(supported && difference != null && difference > 0), currentChromium, latestChromium, latestVersion: latestVersion || null }
}

async function readChromiumVersion(shellApp: string): Promise<string> {
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(shellApp, 'Contents/Info.plist')], {
      timeout: 3_000,
    })
    return stdout.trim()
  }
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:CHAYA_SHELL_EXECUTABLE).VersionInfo.ProductVersion'],
      { timeout: 3_000, windowsHide: true, env: { ...process.env, CHAYA_SHELL_EXECUTABLE: path.join(shellApp, 'nw.exe') } }
    )
    return stdout.trim()
  }
  return ''
}

export async function getNwShellUpdate(shellApp: string) {
  try {
    const currentChromium = await readChromiumVersion(shellApp)
    if (!parseVersion(currentChromium)) return { available: false }
    return assessNwShellUpdate(currentChromium, await getReleases(), nwFileKey(process.platform, process.arch))
  } catch {
    return { available: false }
  }
}
