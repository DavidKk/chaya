import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { json } from '@/initializer/response'
import { AGENT_POLL_WAIT_MS, type AgentPollRequest, type AgentPollResponse, sanitizeAgentGameInfo } from '@/lib/runtime/agent-protocol'
import { canUseDisk } from '@/lib/service-mode/mode'
import { pollAgentCommands } from '@/services/runtime/agent-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Chaya-Launch-Token',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** In-game ChayaAgent long-poll: deliver results, receive queued MCP commands. Room is checked in `mayAccessApi`. */
export const POST = defineApiRoute('post:/api/runtime/agent', async ({ request }) => {
  if (!canUseDisk()) return json({ ok: false, error: { code: 'LOCAL_ONLY', message: 'Agent 桥仅本机模式可用' } }, { status: 404, headers: CORS })
  const body = (await request.json().catch(() => null)) as AgentPollRequest | null
  const roomId = String(body?.roomId || '').trim()
  if (!roomId) return json({ ok: false, error: { code: 'BAD_REQUEST', message: '缺少 roomId' } }, { status: 400, headers: CORS })

  const commands = await pollAgentCommands(roomId, {
    info: sanitizeAgentGameInfo(body?.info),
    results: Array.isArray(body?.results) ? body.results : [],
    waitMs: AGENT_POLL_WAIT_MS,
    signal: request.signal,
  })
  return json({ ok: true, commands } satisfies AgentPollResponse, { headers: CORS })
})
