import fs from 'node:fs'
import path from 'node:path'

import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, openInFinder, requireDisk, revealInFinder } from '@/services/disk-ops'

export const runtime = 'nodejs'

export const POST = defineApiRoute('post:/api/reveal', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    target?: 'project' | 'shell' | 'content'
    reveal?: boolean
    path?: string
    gameId?: string
    gameRoot?: string
  }

  let target = typeof body.path === 'string' && body.path.trim() ? path.resolve(body.path.trim()) : undefined

  if (!target) {
    const resolved = getResolvedFromConfig(body.gameId ? { gameId: body.gameId } : body.gameRoot ? { gameRoot: body.gameRoot } : undefined)
    if (!resolved.ok) {
      return apiBadRequest(resolved.error)
    }
    target = body.target === 'shell' ? resolved.shellApp : body.target === 'content' ? resolved.contentRoot : resolved.projectRoot
  }

  if (!target || !fs.existsSync(target)) {
    return apiError(404, 'PATH_NOT_FOUND', `路径不存在: ${target || ''}`)
  }

  try {
    const stat = fs.statSync(target)
    const isMacApp = target.toLowerCase().endsWith('.app')
    const shouldReveal = body.reveal !== undefined ? body.reveal : stat.isFile() || isMacApp
    if (shouldReveal) {
      await revealInFinder(target)
    } else {
      await openInFinder(target)
    }
    return apiOk({ path: target })
  } catch (err) {
    return apiError(500, 'REVEAL_FAILED', err instanceof Error ? err.message : String(err))
  }
})
