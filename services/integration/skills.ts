import fs from 'node:fs'
import path from 'node:path'

import type { Locale } from '@/lib/i18n/locales'
import { type SkillId, splitFrontmatter } from '@/lib/integration/skills'

/** Literal `skills/` path segment keeps the files in output file tracing (the detail page renders on demand). */
export function readSkillSource(id: SkillId): string {
  return fs.readFileSync(path.join(process.cwd(), 'skills', id, 'SKILL.md'), 'utf8')
}

export function readSkill(id: SkillId) {
  const source = readSkillSource(id)
  return { source, ...splitFrontmatter(source) }
}

/** Display body for the page: skills are maintained in English only without multilingual overhead. */
export function readSkillBody(id: SkillId, _locale?: Locale): string {
  return readSkill(id).body
}
