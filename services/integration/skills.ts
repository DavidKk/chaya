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

/** Display body for the page: `en` is the agent `SKILL.md` body, others read `i18n/<locale>.md` (falls back to English). */
export function readSkillBody(id: SkillId, locale: Locale): string {
  if (locale !== 'en') {
    try {
      return fs.readFileSync(path.join(process.cwd(), 'skills', id, 'i18n', `${locale}.md`), 'utf8')
    } catch {
      // fall through to English
    }
  }
  return readSkill(id).body
}
