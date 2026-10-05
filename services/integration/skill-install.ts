import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SKILL_AGENT_TARGETS, type SkillAgentTargetId, type SkillId } from '@/lib/integration/skills'
import { readSkillSource } from '@/services/integration/skills'

export type SkillInstallStatus = Record<SkillAgentTargetId, { installed: boolean }>

/** `~/.agents/skills` → absolute per-user dir (same layout on every OS) */
function targetDir(target: SkillAgentTargetId): string {
  const dir = SKILL_AGENT_TARGETS.find((item) => item.id === target)!.dir
  return path.join(os.homedir(), ...dir.replace(/^~\//, '').split('/'))
}

function skillFile(id: SkillId, target: SkillAgentTargetId): string {
  return path.join(targetDir(target), id, 'SKILL.md')
}

export function getSkillInstallStatus(id: SkillId): SkillInstallStatus {
  return Object.fromEntries(SKILL_AGENT_TARGETS.map(({ id: target }) => [target, { installed: fs.existsSync(skillFile(id, target)) }])) as SkillInstallStatus
}

/** Writes the English `SKILL.md` (what agents read); overwrites an older copy */
export function installSkill(id: SkillId, target: SkillAgentTargetId): void {
  const file = skillFile(id, target)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, readSkillSource(id))
}

/** Removes our `SKILL.md`; the skill folder goes too only when nothing else is left in it */
export function uninstallSkill(id: SkillId, target: SkillAgentTargetId): void {
  const file = skillFile(id, target)
  fs.rmSync(file, { force: true })
  try {
    fs.rmdirSync(path.dirname(file))
  } catch {
    /* not empty or already gone */
  }
}
