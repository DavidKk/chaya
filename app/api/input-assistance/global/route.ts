import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { type InputAssistConfig, parseInputAssistConfig, validateRule } from '@/lib/game/input-assistance'
import { requireDisk } from '@/lib/service-mode'
import { storageCall } from '@/services/storage/client'

export const runtime = 'nodejs'

function readConfig(): InputAssistConfig {
  return parseInputAssistConfig(storageCall('config.get', ['inputAssistance']))
}

export const GET = defineApiRoute('get:/api/input-assistance/global', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ config: readConfig() })
})

export const PUT = defineApiRoute('put:/api/input-assistance/global', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = await request.json().catch(() => null)
  const raw = body?.config
  const next = parseInputAssistConfig(raw)
  if (!raw || raw.version !== 1 || !Array.isArray(raw.rules) || raw.rules.length !== next.rules.length) return apiBadRequest('Rule configuration contains invalid data')
  for (const rule of next.rules) {
    const issue = validateRule(rule, false)[0]
    if (issue) return apiBadRequest(`${rule.name}: ${issue.message}`)
  }
  const current = readConfig()
  if (body.expectedRevision !== current.revision || next.revision !== current.revision + 1)
    return apiBadRequest('Global configuration was modified elsewhere, please refresh and retry', 'REVISION_CONFLICT')
  try {
    storageCall('config.set', ['inputAssistance', next, body.expectedRevision])
  } catch (error) {
    if (error instanceof Error && error.message === 'REVISION_CONFLICT')
      return apiBadRequest('Global configuration was modified elsewhere, please refresh and retry', 'REVISION_CONFLICT')
    throw error
  }
  return apiOk({ config: next })
})
