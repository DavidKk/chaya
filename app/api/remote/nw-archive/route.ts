import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { normalizeNwVersion, nwArchiveName, nwDownloadUrl } from '@/lib/game/nw-download-meta'

export const runtime = 'nodejs'
/** 官方包约 200MB；自托管可忽略；Vercel 需足够 duration */
export const maxDuration = 600

const FILE_RE = /^(win|osx|linux)-(x64|ia32|arm64)$/

/**
 * 同源代理 NW.js 压缩包（CDN 无 CORS，浏览器无法直拉）。
 * RemoteOnly：只转发官方包，不写用户盘。
 */
export const GET = defineApiRoute('get:/api/remote/nw-archive', async ({ request }) => {
  const url = new URL(request.url)
  const versionRaw = String(url.searchParams.get('version') || '').trim()
  const file = String(url.searchParams.get('file') || '').trim()
  if (!versionRaw || !FILE_RE.test(file)) {
    return NextResponse.json({ ok: false, error: { message: '需要 version 与合法 file（如 win-x64）' } }, { status: 400 })
  }
  const version = normalizeNwVersion(versionRaw)
  const upstream = nwDownloadUrl(version, file)
  const archive = nwArchiveName(version, file)

  try {
    const res = await fetch(upstream, { redirect: 'follow' })
    if (!res.ok || !res.body) {
      return NextResponse.json({ ok: false, error: { message: `上游下载失败 HTTP ${res.status}` } }, { status: 502 })
    }
    const headers = new Headers()
    headers.set('Content-Type', 'application/zip')
    headers.set('Content-Disposition', `attachment; filename="${archive}"`)
    headers.set('Cache-Control', 'public, max-age=86400')
    const len = res.headers.get('content-length')
    if (len) headers.set('Content-Length', len)
    return new NextResponse(res.body, { status: 200, headers })
  } catch (e) {
    return NextResponse.json({ ok: false, error: { message: e instanceof Error ? e.message : String(e) } }, { status: 502 })
  }
})
