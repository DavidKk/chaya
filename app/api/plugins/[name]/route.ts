import fs from 'node:fs'

import { NextResponse } from 'next/server'

import { PLUGIN_LOADER_NAME } from '@/constants/brand'
import { defineApiRoute } from '@/initializer/controller'
import { TRACKED_PLUGINS } from '@/lib/game'
import { resolveKitPluginSource } from '@/services/game'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
}

const ALLOWED = new Set<string>([...TRACKED_PLUGINS, PLUGIN_LOADER_NAME])

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function etagFor(src: string) {
  const st = fs.statSync(src)
  return `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`
}

/**
 * 局内 ChayaLoader 拉取跟踪插件 IIFE（CORS + no-store；ETag 可选）。
 * 开发热替换改走 `/api/plugins/stream` SSE，不再轮询本接口。
 * 允许 TRACKED + Loader（云端 FSA 写入需要 Loader）。
 */
export const GET = defineApiRoute('get:/api/plugins/:name', async ({ request, context }) => {
  const params = await context.params
  const raw = String(params.name || '')
    .trim()
    .replace(/\.js$/i, '')
  if (!raw || !ALLOWED.has(raw)) {
    return new NextResponse('Not Found', { status: 404, headers: CORS })
  }

  const src = resolveKitPluginSource(raw)
  if (!src) {
    return new NextResponse(`Missing plugins build: ${raw} (pnpm build:plugins)`, {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const etag = etagFor(src)
  const inm = request.headers.get('if-none-match')
  if (inm && inm === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ...CORS, ETag: etag, 'Cache-Control': 'no-store' },
    })
  }

  const body = fs.readFileSync(src)
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      ETag: etag,
    },
  })
})
