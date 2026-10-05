import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { isSkillId, SKILL_AGENT_TARGETS, type SkillAgentTargetId } from '@/lib/integration/skills'
import { requireDisk } from '@/services/disk-ops'
import { getSkillInstallStatus, installSkill, uninstallSkill } from '@/services/integration/skill-install'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `?id=<skill>`: whether each agent's global skills dir has it */
export const GET = defineApiRoute('get:/api/integration/skills/install', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const id = new URL(request.url).searchParams.get('id')
  if (!isSkillId(id)) return apiBadRequest('unknown skill')
  return apiOk({ targets: getSkillInstallStatus(id) })
})

/** `{ id, target, action: 'install' | 'uninstall' }`: write / remove `<target dir>/<id>/SKILL.md` */
export const POST = defineApiRoute('post:/api/integration/skills/install', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; target?: unknown; action?: unknown }
  const id = typeof body.id === 'string' ? body.id : null
  if (!isSkillId(id)) return apiBadRequest('unknown skill')
  const target = SKILL_AGENT_TARGETS.find((item) => item.id === body.target)?.id as SkillAgentTargetId | undefined
  if (!target) return apiBadRequest('unknown target')
  if (body.action !== 'install' && body.action !== 'uninstall') return apiBadRequest('action must be install or uninstall')
  try {
    if (body.action === 'install') installSkill(id, target)
    else uninstallSkill(id, target)
  } catch (error) {
    return apiError(500, 'SKILL_INSTALL_FAILED', error instanceof Error ? error.message : String(error))
  }
  return apiOk({ targets: getSkillInstallStatus(id) })
})
