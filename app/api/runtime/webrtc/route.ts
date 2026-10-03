import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { json } from '@/initializer/response'
import { GAME_LINK_TOKEN_HEADER } from '@/lib/runtime/game-link-protocol'
import { canUseDisk } from '@/lib/service-mode'
import {
  checkRoomToken,
  getSignalingRoom,
  publishAnswer,
  publishOffer,
  resetSignalingRoom,
  type RoomAccess,
  setWebConnected,
  type SignalingSdp,
} from '@/services/runtime/webrtc-signaling'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': `Content-Type, X-Chaya-Launch-Token, ${GAME_LINK_TOKEN_HEADER}`,
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

function fail(status: number, code: string, message: string) {
  return json({ ok: false, error: { code, message } }, { status, headers: CORS })
}

const bad = (message: string) => fail(400, 'BAD_REQUEST', message)

/**
 * 客户端地址：优先反代覆盖写入的 `x-real-ip`（Vercel / nginx 常规配置），再退回 `x-forwarded-for` 首段（可被客户端伪造，仅尽力而为）。
 * 取不到时不按来源限制，只受房间总数上限约束。
 */
function clientIp(request: Request): string | undefined {
  return request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

/**
 * 浏览器模式无管理授权，靠连接令牌（页面生成并写入游戏 Env）隔离房间。
 * 服务端模式由 `mayAccessApi` 校验管理会话 / launch token，这里不再检查。
 */
function roomGate(request: Request, roomId: string, claim: boolean): { access: RoomAccess } | { response: Response } {
  if (canUseDisk()) return { access: 'ok' }
  const token = String(request.headers.get(GAME_LINK_TOKEN_HEADER) || '').trim()
  if (!token) return { response: fail(401, 'LINK_TOKEN_REQUIRED', '缺少连接令牌：请在 Chaya 中重新点击「连接」后再启动游戏') }
  const access = checkRoomToken(roomId, token, { claim, owner: clientIp(request) })
  if (access === 'forbidden') return { response: fail(403, 'LINK_TOKEN_MISMATCH', '连接令牌不匹配：请在 Chaya 中重新点击「连接」后重启游戏') }
  if (access === 'full') return { response: fail(503, 'SIGNALING_FULL', '连接服务繁忙，请稍后再试') }
  if (access === 'limited') return { response: fail(429, 'SIGNALING_RATE_LIMITED', '同时连接的游戏过多，请稍后再试') }
  return { access }
}

/** WebRTC 信令：offer / answer / 连接态（内存板）；局内需 CORS */
export const GET = defineApiRoute('get:/api/runtime/webrtc', async ({ request }) => {
  const roomId = String(new URL(request.url).searchParams.get('roomId') || '').trim()
  if (!roomId) return bad('缺少 roomId')
  const gate = roomGate(request, roomId, false)
  if ('response' in gate) return gate.response
  return json({ ok: true, room: gate.access === 'absent' ? null : getSignalingRoom(roomId) }, { headers: CORS })
})

export const POST = defineApiRoute('post:/api/runtime/webrtc', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Body | null
  const action = String(body?.action || '').trim()
  const roomId = String(body?.roomId || '').trim()
  if (!roomId) return bad('缺少 roomId')

  if (action === 'offer' || action === 'reset') {
    const gate = roomGate(request, roomId, true)
    if ('response' in gate) return gate.response
    if (action === 'reset') {
      resetSignalingRoom(roomId)
      return json({ ok: true, reset: true, roomId }, { headers: CORS })
    }
    const sdp = body?.sdp
    if (!sdp?.type || sdp.type !== 'offer') return bad('缺少 offer sdp')
    return json({ ok: true, room: publishOffer(roomId, sdp) }, { headers: CORS })
  }

  if (action === 'answer' || action === 'connected') {
    const gate = roomGate(request, roomId, false)
    if ('response' in gate) return gate.response
    if (action === 'answer') {
      const sdp = body?.sdp
      if (!sdp?.type || sdp.type !== 'answer') return bad('缺少 answer sdp')
      const room = publishAnswer(roomId, sdp)
      return room ? json({ ok: true, room }, { headers: CORS }) : fail(404, 'ROOM_NOT_FOUND', '房间不存在或已过期')
    }
    return json({ ok: true, room: setWebConnected(roomId, !!body?.connected) }, { headers: CORS })
  }

  return bad(`未知 action: ${action || '(empty)'}`)
})
