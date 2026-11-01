import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { captureGameScreenshot } from '@/services/runtime/game-instance-manager'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function placeholderSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="none">
  <rect width="640" height="360" fill="#090d16" />
  <circle cx="320" cy="160" r="40" fill="#1e293b" />
  <path d="M305 145h30v30h-30z" stroke="#64748b" stroke-width="2" fill="none" stroke-linejoin="round" />
</svg>
`.trim()
}

/** Return a cached low-frequency preview, independent of live WebRTC capture. */
export const GET = defineApiRoute('get:/api/remote/screenshot', async ({ request }) => {
  const url = new URL(request.url)
  const roomId = url.searchParams.get('roomId') || 'default'
  const maxWidth = parseInt(url.searchParams.get('maxWidth') || '800', 10)

  const shot = await captureGameScreenshot(roomId, maxWidth)
  if (shot?.data) {
    const buffer = Buffer.from(shot.data, 'base64')
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': shot.mimeType || 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }

  return new NextResponse(placeholderSvg(), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
})
