/** Agent skills shipped in `skills/<id>/SKILL.md` (client-safe list; sources read in `services/integration/skills`). */

export const SKILLS = [
  { id: 'chaya-setup', title: '安装与三种形态', summary: 'Chaya 是什么；Edge / 本地 dev / App 的区别与安装。' },
  { id: 'chaya-launch', title: '添加游戏与启动', summary: '装壳、插件、启动游戏，以及修改 / 翻译 / 日志的流程。' },
  { id: 'chaya-mcp', title: 'Agent 控制游戏（MCP）', summary: '连接本机 MCP、工具分组、标准工作流与场景配方。' },
] as const

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

export const SKILL_AGENT_TARGETS = [
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
