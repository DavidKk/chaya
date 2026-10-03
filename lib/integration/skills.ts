/**
 * Agent skills shipped in `skills/<id>/SKILL.md` (client-safe list; sources read in `services/integration/skills`).
 * `SKILL.md` is English and is what agents install; `skills/<id>/i18n/<locale>.md` are page-only translations.
 */
import type { Locale } from '@/lib/i18n/locales'

type SkillText = Record<Locale, string>

export const SKILLS = [
  {
    id: 'chaya-setup',
    title: { en: 'Setup and the three modes', zh: '安装与三种形态', ja: 'インストールと 3 つの形態', ko: '설치와 세 가지 형태' },
    summary: {
      en: 'What Chaya is; how Edge, local dev and the App differ and how to install each.',
      zh: 'Chaya 是什么；Edge / 本地 dev / App 的区别与安装。',
      ja: 'Chaya とは何か。Edge / ローカル dev / App の違いとインストール。',
      ko: 'Chaya란 무엇인지, Edge / 로컬 dev / App의 차이와 설치.',
    },
  },
  {
    id: 'chaya-launch',
    title: { en: 'Add and launch games', zh: '添加游戏与启动', ja: 'ゲームの追加と起動', ko: '게임 추가와 실행' },
    summary: {
      en: 'Shell, plugins, launching, and the cheat / translate / logs workflows.',
      zh: '装壳、插件、启动游戏，以及修改 / 翻译 / 日志的流程。',
      ja: 'シェル、プラグイン、起動、そして改造 / 翻訳 / ログの流れ。',
      ko: '셸, 플러그인, 게임 실행, 그리고 수정 / 번역 / 로그 흐름.',
    },
  },
  {
    id: 'chaya-mcp',
    title: { en: 'Agent game control (MCP)', zh: 'Agent 控制游戏（MCP）', ja: 'エージェントでゲーム操作（MCP）', ko: '에이전트 게임 조작(MCP)' },
    summary: {
      en: 'Connect the local MCP, tool groups, the standard workflow and recipes.',
      zh: '连接本机 MCP、工具分组、标准工作流与场景配方。',
      ja: 'ローカル MCP の接続、ツールのグループ、標準ワークフローとレシピ。',
      ko: '로컬 MCP 연결, 도구 그룹, 표준 작업 흐름과 활용 예.',
    },
  },
] as const satisfies readonly { id: string; title: SkillText; summary: SkillText }[]

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
