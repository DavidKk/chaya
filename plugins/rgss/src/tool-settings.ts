import { normalizeToolSettings, readCachedToolSettings } from '@/lib/game-agent/tool-settings'

/** RGSS overlay settings stay available without a local translation/control service. */
export async function requestToolSettings(_path: string, init?: RequestInit): Promise<Response> {
  const current = readCachedToolSettings()
  const body = init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as { patch?: unknown }) : null
  const settings = normalizeToolSettings(init?.method === 'PUT' ? { ...current, ...((body?.patch as object) ?? {}) } : current)
  return new Response(JSON.stringify({ settings }), { headers: { 'Content-Type': 'application/json' } })
}
