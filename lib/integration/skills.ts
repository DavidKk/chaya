/**
 * Agent skills shipped in `skills/<id>/SKILL.md` (client-safe list; sources read in `services/integration/skills`).
 * Skills are maintained in English only; no multilingual translations needed.
 */
export const SKILLS = [
  {
    id: 'chaya-setup',
    title: 'Setup and the three modes',
    summary: 'What Chaya is; how Cloud, local dev and the App differ and how to install each.',
  },
  {
    id: 'chaya-launch',
    title: 'Add and launch games',
    summary: 'Shell, plugins, launching, and the cheat / translate / logs workflows.',
  },
  {
    id: 'chaya-mcp',
    title: 'Agent game control (MCP)',
    summary: 'Connect the local MCP, tool groups, the standard workflow and recipes.',
  },
] as const satisfies readonly { id: string; title: string; summary: string }[]

export type SkillId = (typeof SKILLS)[number]['id']

export const SKILL_RAW_PREFIX = '/skills/'
export const INTEGRATION_SKILLS_PATH = '/integration/skills'

const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id))

export function isSkillId(raw: string | undefined | null): raw is SkillId {
  return Boolean(raw && SKILL_IDS.has(raw))
}

export function skillRawPath(id: SkillId): string {
  return `${SKILL_RAW_PREFIX}${id}.md`
}

export function integrationSkillHref(id: SkillId): string {
  return `${INTEGRATION_SKILLS_PATH}/${id}`
}

/** `agents`：多 Agent 共用的 `~/.agents/skills`（Cursor、Codex 等支持该约定） */
export const SKILL_AGENT_TARGETS = [
  { id: 'agents', label: 'Universal', dir: '~/.agents/skills' },
  { id: 'cursor', label: 'Cursor', dir: '~/.cursor/skills' },
  { id: 'claude', label: 'Claude Code', dir: '~/.claude/skills' },
  { id: 'codex', label: 'Codex', dir: '~/.codex/skills' },
] as const

export type SkillAgentTargetId = (typeof SKILL_AGENT_TARGETS)[number]['id']

export function skillInstallCommand(origin: string, id: SkillId, target: SkillAgentTargetId): string {
  const dir = SKILL_AGENT_TARGETS.find((t) => t.id === target)?.dir ?? SKILL_AGENT_TARGETS[0].dir
  const url = `${origin.replace(/\/+$/, '')}${skillRawPath(id)}`
  return `mkdir -p ${dir}/${id} && curl -fsSL ${url} -o ${dir}/${id}/SKILL.md`
}

/** Split `---` frontmatter from the markdown body */
export function splitFrontmatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return { meta: {}, body: source }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: source.slice(match[0].length) }
}
