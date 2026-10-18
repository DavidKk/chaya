import { readSkill, searchSkills, skillIndex } from '@/lib/runtime/skill-registry'

import { optNum, optStr } from './args'
import type { ToolImpls } from './types'

export function makeSkillTools(): ToolImpls {
  return {
    async chaya_skills_list(args) {
      const parent = optStr(args, 'parent')
      const entries = parent ? skillIndex().filter((skill) => skill.parent === parent) : skillIndex()
      return { skills: entries, count: entries.length }
    },
    async chaya_skills_search(args) {
      const query = optStr(args, 'query')
      if (!query) throw new Error('Missing parameter query')
      const limit = Math.min(50, Math.max(1, Math.trunc(optNum(args, 'limit') ?? 10)))
      const results = searchSkills(query).slice(0, limit)
      return { query, results, count: results.length }
    },
    async chaya_skills_read(args) {
      const id = optStr(args, 'id')
      if (!id) throw new Error('Missing parameter id')
      const skill = readSkill(id)
      if (!skill) throw new Error(`Skill not found: ${id}`)
      return skill
    },
  }
}
