import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { json } from '@/initializer/response'
import { getSignalingRoom, publishAnswer, publishOffer, resetSignalingRoom, setWebConnected, type SignalingSdp } from '@/services/runtime/webrtc-signaling'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Chaya-Launch-Token',
}

type Body = {
  action?: string
  roomId?: string
  sdp?: SignalingSdp
  connected?: boolean
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function bad(message: string) {
  return json({ ok: false, error: { code: 'BAD_REQUEST', message } }, { status: 400, headers: CORS })
}

/** WebRTC 信令：offer / answer / 连接态（本机内存板）；局内需 CORS */
export const GET = defineApiRoute('get:/api/runtime/webrtc', async ({ request }) => {
  const url = new URL(request.url)
  const roomId = url.searchParams.get('roomId') || 'default'
  return json({ ok: true, room: getSignalingRoom(roomId) }, { headers: CORS })
})

export const POST = defineApiRoute('post:/api/runtime/webrtc', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Body | null
  const action = String(body?.action || '').trim()
  const roomId = String(body?.roomId || 'default').trim() || 'default'

  if (action === 'offer') {
    const sdp = body?.sdp
    if (!sdp?.type || sdp.type !== 'offer') return bad('缺少 offer sdp')
    return json({ ok: true, room: publishOffer(roomId, sdp) }, { headers: CORS })
  }
  if (action === 'answer') {
    const sdp = body?.sdp
    if (!sdp?.type || sdp.type !== 'answer') return bad('缺少 answer sdp')
    return json({ ok: true, room: publishAnswer(roomId, sdp) }, { headers: CORS })
  }
  if (action === 'connected') {
    return json({ ok: true, room: setWebConnected(roomId, !!body?.connected) }, { headers: CORS })
  }
  if (action === 'reset') {
    resetSignalingRoom(roomId)
    return json({ ok: true, reset: true, roomId }, { headers: CORS })
  }
  return bad(`未知 action: ${action || '(empty)'}`)
})
