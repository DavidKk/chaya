/**
 * Agent skills shipped in `skills/<id>/SKILL.md` (client-safe list; sources read in `services/integration/skills`).
 * `SKILL.md` is English and is what agents install; `skills/<id>/i18n/<locale>.md` are page-only translations.
 */
import type { Locale } from '@/lib/i18n/locales'

type SkillText = Record<Locale, string>

export const SKILLS = [
  {
    id: 'chaya-setup',
    title: {
      en: 'Setup and the three modes',
      zh: '安装与三种形态',
      cht: '安裝與三種形態',
      ja: 'インストールと 3 つの形態',
      ko: '설치와 세 가지 형태',
      fr: 'Installation et les trois modes',
      de: 'Installation und die drei Modi',
      es: 'Instalación y los tres modos',
      ru: 'Установка и три режима',
      'pt-BR': 'Instalação e os três modos',
    },
    summary: {
      en: 'What Chaya is; how Cloud, local dev and the App differ and how to install each.',
      zh: 'Chaya 是什么；Cloud / 本地 dev / App 的区别与安装。',
      cht: 'Chaya 是什麼；Cloud / 本地 dev / App 的區別與安裝。',
      ja: 'Chaya とは何か。Cloud / ローカル dev / App の違いとインストール。',
      ko: 'Chaya란 무엇인지, Cloud / 로컬 dev / App의 차이와 설치.',
      fr: "Ce qu'est Chaya ; différences et installation entre Cloud, dev local et App.",
      de: 'Was Chaya ist; Unterschiede und Installation von Cloud, lokalem Dev und App.',
      es: 'Qué es Chaya; diferencias e instalación de Cloud, dev local y App.',
      ru: 'Что такое Chaya; различия и установка Cloud, локального dev и App.',
      'pt-BR': 'O que é o Chaya; diferenças e instalação do Cloud, dev local e App.',
    },
  },
  {
    id: 'chaya-launch',
    title: {
      en: 'Add and launch games',
      zh: '添加游戏与启动',
      cht: '添加遊戲與啟動',
      ja: 'ゲームの追加と起動',
      ko: '게임 추가와 실행',
      fr: 'Ajouter et lancer des jeux',
      de: 'Spiele hinzufügen und starten',
      es: 'Añadir e iniciar juegos',
      ru: 'Добавление и запуск игр',
      'pt-BR': 'Adicionar e iniciar jogos',
    },
    summary: {
      en: 'Shell, plugins, launching, and the cheat / translate / logs workflows.',
      zh: '装壳、插件、启动游戏，以及修改 / 翻译 / 日志的流程。',
      cht: '裝殼、外掛程式、啟動遊戲，以及修改 / 翻譯 / 日誌的流程。',
      ja: 'シェル、プラグイン、起動、そして改造 / 翻訳 / ログの流れ。',
      ko: '셸, 플러그인, 게임 실행, 그리고 수정 / 번역 / 로그 흐름.',
      fr: 'Shell, plugins, lancement et flux de travail de triche / traduction / journaux.',
      de: 'Shell, Plugins, Starten und Workflows für Cheat / Übersetzung / Protokolle.',
      es: 'Shell, plugins, lanzamiento y flujos de trabajo de trucos / traducción / registros.',
      ru: 'Оболочка, плагины, запуск и рабочие процессы читов / перевода / журналов.',
      'pt-BR': 'Shell, plugins, inicialização e fluxos de trapaça / tradução / logs.',
    },
  },
  {
    id: 'chaya-mcp',
    title: {
      en: 'Agent game control (MCP)',
      zh: 'Agent 控制游戏（MCP）',
      cht: 'Agent 控制遊戲（MCP）',
      ja: 'エージェントでゲーム操作（MCP）',
      ko: '에이전트 게임 조작(MCP)',
      fr: 'Contrôle de jeu par Agent (MCP)',
      de: 'Agent-Spielsteuerung (MCP)',
      es: 'Control de juego por agente (MCP)',
      ru: 'Управление игрой через Agent (MCP)',
      'pt-BR': 'Controle de jogo por Agent (MCP)',
    },
    summary: {
      en: 'Connect the local MCP, tool groups, the standard workflow and recipes.',
      zh: '连接本机 MCP、工具分组、标准工作流与场景配方。',
      cht: '連接本機 MCP、工具分組、標準工作流程與場景配方。',
      ja: 'ローカル MCP の接続、ツールのグループ、標準ワークフローとレシピ。',
      ko: '로컬 MCP 연결, 도구 그룹, 표준 작업 흐름과 활용 예.',
      fr: 'Connexion au MCP local, groupes d\x27outils, flux standard et recettes.',
      de: 'Lokales MCP verbinden, Tool-Gruppen, Standard-Workflow und Rezepte.',
      es: 'Conectar MCP local, grupos de herramientas, flujo estándar y recetas.',
      ru: 'Подключение локального MCP, группы инструментов, стандартный рабочий процесс и рецепты.',
      'pt-BR': 'Conecte o MCP local, grupos de ferramentas, fluxo de trabalho padrão e receitas.',
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
