import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { normalizeNwVersion, nwArchiveName, nwDownloadUrl, nwFileKey } from '@/lib/game/nw-download-meta'

export const runtime = 'nodejs'
export const maxDuration = 600

/**
 * 元信息：当前平台应下哪个 NW 包（浏览器可直接用；装壳下载走 nw-archive 代理）。
 * RemoteOnly，不碰用户盘。
 */
export const GET = defineApiRoute('get:/api/remote/nw-meta', async ({ request }) => {
  const url = new URL(request.url)
  const platform = (url.searchParams.get('platform') || '').trim() || 'win32'
  const arch = (url.searchParams.get('arch') || '').trim() || 'x64'
  try {
    const fileKey = platform === 'win32' || platform === 'darwin' || platform === 'linux' ? nwFileKey(platform, arch) : nwFileKey('win32', arch)

    const verRes = await fetch('https://nwjs.io/versions.json', { redirect: 'follow' })
    if (!verRes.ok) return apiBadRequest(`versions.json HTTP ${verRes.status}`)
    const versions = (await verRes.json()) as {
      stable?: string
      latest?: string
      versions?: Array<{ version: string; components?: { chromium?: string } }>
    }
    const version = normalizeNwVersion(versions.stable || versions.latest || '')
    const meta = versions.versions?.find((v) => normalizeNwVersion(v.version) === version)
    return apiOk({
      version,
      fileKey,
      archive: nwArchiveName(version, fileKey),
      url: nwDownloadUrl(version, fileKey),
      proxyPath: `/api/remote/nw-archive?version=${encodeURIComponent(version)}&file=${encodeURIComponent(fileKey)}`,
      chromium: meta?.components?.chromium,
    })
  } catch (e) {
    return apiBadRequest(e instanceof Error ? e.message : String(e))
  }
})
