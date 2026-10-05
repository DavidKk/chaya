import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { kitPluginDigests } from '@/services/game'

export const runtime = 'nodejs'

/** Browser mode compares the game's plugin files with these to offer "update plugins". */
export const GET = defineApiRoute('get:/api/plugins/digests', async () => {
  return NextResponse.json({ ok: true, digests: kitPluginDigests() }, { headers: { 'Cache-Control': 'no-store' } })
})
