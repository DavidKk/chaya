import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { json } from '@/initializer/response'
import { checkAndReclaimIdleInstances, DEFAULT_IDLE_TIMEOUT_SECONDS, listCloudGameInstances, terminateCloudGameInstance } from '@/services/runtime/game-instance-manager'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** 查询当前所有运行中的云游戏实例 */
export const GET = defineApiRoute('get:/api/remote/instances', async () => {
  // 先触发一次巡检回收
  await checkAndReclaimIdleInstances().catch(() => {})
  const instances = listCloudGameInstances()
  return json(
    {
      ok: true,
      instances,
      count: instances.length,
      idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
    },
    { headers: CORS }
  )
})

/** 终止指定的云游戏实例，或一键清理所有运行中的实例 */
export const DELETE = defineApiRoute('delete:/api/remote/instances', async ({ request }) => {
  let pid: number | undefined
  let contentRoot: string | undefined
  try {
    const body = await request.json().catch(() => ({}))
    if (body?.pid) pid = Number(body.pid)
    if (body?.contentRoot) contentRoot = String(body.contentRoot)
  } catch {
    /* */
  }

  const res = await terminateCloudGameInstance({ pid, contentRoot })
  return json({ ok: true, killed: res.killed }, { headers: CORS })
})
