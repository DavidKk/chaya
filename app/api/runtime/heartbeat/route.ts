import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { json } from '@/initializer/response'
import { requireDisk } from '@/lib/service-mode'
import { clearGameQuitRequest, detectLanApiBases, getGamePresence, preferredPluginApiBase, registerGameFromPlugin, toolkitListenPort, touchGamePresence } from '@/services/runtime'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Chaya-Launch-Token',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** 查询游戏是否在线（最近心跳）+ 局域网 API 提示 */
export const GET = defineApiRoute('get:/api/runtime/heartbeat', async () => {
  const port = toolkitListenPort()
  const presence = getGamePresence()
  return json(
    {
      ok: true,
      presence,
      quit: presence.quitRequested,
      apiBase: preferredPluginApiBase(port),
      lanBases: detectLanApiBases(port),
      loopback: `http://127.0.0.1:${port}`,
    },
    { headers: CORS }
  )
})

/**
 * 局内插件心跳：证明游戏在跑；可带路径以被动入库。
 * body: { sessionId?, contentRoot?, gameRoot?, name?, platform?, launchToken? }
 * - 无有效 launchToken：只更新在线，不改游戏库
 * - 有 token：按签发时的本地路径入库
 * - quitRequested：响应 quit:true 且不延长 online，随后清除退出旗标
 */
export const POST = defineApiRoute('post:/api/runtime/heartbeat', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string
    contentRoot?: string
    gameRoot?: string
    name?: string
    platform?: string
    launchToken?: string
  } | null

  const ua = request.headers.get('user-agent')
  const contentRoot = body?.contentRoot ? String(body.contentRoot).trim() : null
  const gameRoot = body?.gameRoot ? String(body.gameRoot).trim() : contentRoot
  const launchToken = body?.launchToken ? String(body.launchToken).trim() : ''

  // 带 launchToken 会写回本机游戏库，属 DiskOps；纯 presence 仍允许
  if (launchToken) {
    const denied = requireDisk()
    if (denied) return denied
  }

  const quit = getGamePresence().quitRequested
  let presence = getGamePresence()
  let register = null as ReturnType<typeof registerGameFromPlugin> | null

  if (!quit) {
    presence = touchGamePresence({
      sessionId: body?.sessionId,
      contentRoot,
      platform: body?.platform ?? null,
      userAgent: ua,
    })
    if (launchToken) {
      register = registerGameFromPlugin({
        gameRoot: gameRoot || '',
        contentRoot: contentRoot || undefined,
        name: body?.name,
        sessionId: body?.sessionId || presence.sessionId || undefined,
        launchToken,
      })
    }
  } else {
    // 道别心跳：不再 touch；清旗标以便下次本机启动
    clearGameQuitRequest()
    presence = getGamePresence()
  }

  return json({ ok: true, presence, register, quit }, { headers: CORS })
})
