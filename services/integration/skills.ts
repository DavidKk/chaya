import fs from 'node:fs'
import path from 'node:path'

import { type SkillId, splitFrontmatter } from '@/lib/integration/skills'

/** Literal `skills/` path segment keeps the files in output file tracing (the detail page renders on demand). */
export function readSkillSource(id: SkillId): string {
  return fs.readFileSync(path.join(process.cwd(), 'skills', id, 'SKILL.md'), 'utf8')
}

export function readSkill(id: SkillId) {
  const source = readSkillSource(id)
  return { source, ...splitFrontmatter(source) }
}
