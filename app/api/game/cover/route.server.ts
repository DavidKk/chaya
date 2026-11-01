import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiOk } from '@/initializer/response'
import { readGameCover } from '@/services/game/cover'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game/cover', async ({ request }) => {
  const url = new URL(request.url)
  const isRaw = url.searchParams.get('raw') === '1' || request.headers.get('accept')?.includes('image/')
  try {
    const gameId = url.searchParams.get('gameId') || url.searchParams.get('game') || undefined
    const coverData = await readGameCover(gameId)

    if (isRaw && coverData?.startsWith('data:')) {
      const match = coverData.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        const mimeType = match[1]
        const buffer = Buffer.from(match[2], 'base64')
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Cache-Control': 'private, max-age=86400',
          },
        })
      }
    }

    if (isRaw) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return apiOk({ cover: coverData })
  } catch {
    if (isRaw) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return apiOk({ cover: null })
  }
})
