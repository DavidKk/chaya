import { COMPANION_CHARACTER_PROFILES, COMPANION_CHARACTERS, type CompanionCharacter, companionWords } from './companion'
import type { GameAgentProvider } from './providers'

export type CompanionGender = 'female' | 'male' | 'other'
export type CompanionVerbosity = 'quiet' | 'normal' | 'chatty'
export type CompanionSpoilers = 'avoid' | 'allow'

export type CompanionDialogueScene = 'chest' | 'battle' | 'danger' | 'idle' | 'explore' | 'custom'

export type CompanionDialogueLine = {
  id: string
  scene: CompanionDialogueScene
  text: string
  createdAt?: number
}

export type RoleWorkspaceTreeNode = {
  path: string
  name: string
  type: 'file' | 'folder'
  title: string
  desc: string
  children?: RoleWorkspaceTreeNode[]
}

export const ROLE_WORKSPACE_TREE: RoleWorkspaceTreeNode[] = [
  { path: 'AGENTS.md', name: 'AGENTS.md', type: 'file', title: 'Agent 行为指令', desc: '核心系统提示词、行为准则与响应规范' },
  { path: 'DREAMS.md', name: 'DREAMS.md', type: 'file', title: '愿景与潜意识', desc: '旅伴内心的长期追求、未解执念与探索动力' },
  { path: 'IDENTITY.md', name: 'IDENTITY.md', type: 'file', title: '身份与人设', desc: '口吻习惯、人设立场与第一人称叙述视角' },
  { path: 'MEMORY.md', name: 'MEMORY.md', type: 'file', title: '长期记忆总览', desc: '心智记忆总览、与玩家共同历险的索引' },
  { path: 'SOUL.md', name: 'SOUL.md', type: 'file', title: '灵魂与价值观', desc: '性格底色、道德倾向与对冒险伙伴的真实态度' },
  { path: 'USER.md', name: 'USER.md', type: 'file', title: '玩家画像', desc: '记录对当前玩家的观察、喜好与称呼方式' },
  { path: 'README.md', name: 'README.md', type: 'file', title: '工作区概览', desc: '旅伴上下文配置与当前运行环境说明' },
  {
    path: 'memory',
    name: 'memory',
    type: 'folder',
    title: '角色记忆库',
    desc: '存储旅伴的探索记录、世界观认知与关键回忆',
    children: [
      { path: 'memory/adventures.md', name: 'adventures.md', type: 'file', title: '历险记录', desc: '阶段性地城探索记录与路线心得' },
      { path: 'memory/lore.md', name: 'lore.md', type: 'file', title: '世界回忆', desc: '旅伴心中的世界背景与深刻回忆' },
    ],
  },
  {
    path: 'skills',
    name: 'skills',
    type: 'folder',
    title: '伴侣技能库',
    desc: '存储旅伴在游戏中的心智技能与交互策略',
    children: [
      { path: 'skills/chest_alert.md', name: 'chest_alert.md', type: 'file', title: '宝箱感知', desc: '感知到周边未开启宝箱时触发提示' },
      { path: 'skills/danger_care.md', name: 'danger_care.md', type: 'file', title: '危机看护', desc: '全队生命值处于低谷时提醒并救急' },
      { path: 'skills/banter.md', name: 'banter.md', type: 'file', title: '闲聊互动', desc: '待机休闲时自然生成对话并记录到台词池' },
    ],
  },
]

export const ROLE_WORKSPACE_FILES = [
  { file: 'AGENTS.md', title: 'Agent 行为指令', desc: '核心系统提示词、行为准则与响应规范' },
  { file: 'DREAMS.md', title: '愿景与潜意识', desc: '旅伴内心的长期追求、未解执念与探索动力' },
  { file: 'IDENTITY.md', title: '身份与人设', desc: '口吻习惯、人设立场与第一人称叙述视角' },
  { file: 'MEMORY.md', title: '长期记忆总览', desc: '心智记忆总览、与玩家共同历险的索引' },
  { file: 'SOUL.md', title: '灵魂与价值观', desc: '性格底色、道德倾向与对冒险伙伴的真实态度' },
  { file: 'USER.md', title: '玩家画像', desc: '记录对当前玩家的观察、喜好与称呼方式' },
  { file: 'README.md', title: '工作区概览', desc: '旅伴上下文配置与当前运行环境说明' },
  { file: 'memory/adventures.md', title: '历险记录 (memory/)', desc: '阶段性探索日记与路线心得' },
  { file: 'memory/lore.md', title: '世界回忆 (memory/)', desc: '旅伴眼中的世界观与往事' },
  { file: 'skills/chest_alert.md', title: '宝箱感知 (skills/)', desc: '周边未开启宝箱时触发提示' },
  { file: 'skills/danger_care.md', title: '危机看护 (skills/)', desc: '生命值处于危险时呼救提醒' },
  { file: 'skills/banter.md', title: '闲聊互动 (skills/)', desc: '待机时自然构思台词互动' },
] as const

export type RoleWorkspaceFileKey = (typeof ROLE_WORKSPACE_FILES)[number]['file']

export type AiRole = {
  id: string
  name: string
  gender: CompanionGender
  avatar: string
  description: string
  provider: GameAgentProvider
  model: string
  lines: CompanionDialogueLine[]
  idleLineGeneration: boolean
  verbosity?: CompanionVerbosity
  spoilers?: CompanionSpoilers
  workspaceFiles?: Record<string, string>
  tag?: string
  chestLine?: string
  battleLine?: string
  dangerLine?: string
  builtin?: boolean
  updatedAt?: number
}

export const AI_ROLES_STORAGE_KEY = 'chaya.ai.roles.v1'
export const AI_ROLES_EVENT = 'chaya:ai-roles-updated'

const DEFAULT_IDLE_LINES: Record<CompanionCharacter, string[]> = {
  nagi: ['累了的话就稍微歇歇脚吧，不用太勉强自己。', '风吹得很舒服呢，这趟旅途比想象中更加宁静。', '不用着急，无论前方是什么，我都会陪在你身旁。'],
  rin: ['喂，发什么呆呢，走快两步，前面的风景可不等我们。', '这里的气氛不错嘛，要是能顺便捡点金币就更好了。', '刚才那波配合很帅气嘛，看来我们越来越有默契了！'],
  rei: ['周边环境安全，可以利用现在的空隙整理背包与补给。', '保持适度警惕即可，目前的行进节奏很合适。', '路线清晰，随时可以准备进入下一区域。'],
  koto: ['这片风景的光影真美，像极了古老长诗里描绘的场景。', '旅途中的每一个驻足，其实都是故事的一部分。', '听听周围的声音，大自然似乎在向我们倾诉什么呢。'],
  yui: ['嘻嘻，接下来我们要往哪个方向探索呢？我都迫不及待了！', '有你一起冒险真是太开心了，今天也要元气满满哦！', '等会儿要是找到好吃的特产，我们一定要买一份尝尝！'],
  towa: ['……附近好像有微弱的气息流动，是我的错觉吗。', '星轨与风向都在暗示着什么……继续往前走吧。', '不用多说，我一直都在留意周围的微小变化。'],
}

export function defaultRoleWorkspaceFileContent(fileKey: string, role: Pick<AiRole, 'id' | 'name' | 'gender' | 'description' | 'provider' | 'model'>): string {
  const genderLabel = role.gender === 'female' ? '女性' : role.gender === 'male' ? '男性' : '其他 / 中性'
  switch (fileKey) {
    case 'AGENTS.md':
      return `# AGENTS.md · ${role.name}\n\n## 运行准则\n- 作为游戏《Chaya》局内旅伴运行，依托 ${role.provider} 后端平台。\n- 在探索地城、发现宝箱、突遇战斗与陷入低血量危险时给予及时、贴合人设的反馈。\n- 在休闲待机时刻，可结合当前环境自主构思并追加新台词。\n`
    case 'DREAMS.md':
      return `# DREAMS.md · ${role.name}\n\n- 愿景：与玩家完成全部主线历险，见证未曾探知的隐秘大陆。\n- 长期目标：建立深厚的冒险羁绊，在关键战斗中成为最坚实的后盾。\n`
    case 'IDENTITY.md':
      return `# IDENTITY.md · ${role.name}\n\n- 名字：${role.name}\n- 性别：${genderLabel}\n- 人设定位：${role.description}\n- 语言习惯：第一人称自然口吻，生动真实，绝不输出枯燥的机器指令感。\n`
    case 'MEMORY.md':
      return `# MEMORY.md · ${role.name}\n\n## 核心历程\n- 与玩家初次在初始小镇相遇，确立冒险同行契约。\n- 共同探索了初始区域，逐步形成战斗默契。\n`
    case 'SOUL.md':
      return `# SOUL.md · ${role.name}\n\n- 灵魂底色：忠诚、陪伴、真诚、富有同理心。\n- 核心原则：无论战况顺逆，始终鼓励玩家，并在危难时优先提醒恢复体力。\n`
    case 'USER.md':
      return `# USER.md · 冒险伙伴档案\n\n- 玩家角色：冒险队队长 / 故事主角\n- 互动倾向：喜欢探索隐藏角落与搜集宝箱，重视战斗节奏与策略。\n`
    case 'README.md':
      return `# README.md · 旅伴工作区 (${role.name})\n\n角色运行上下文工作区。\n包含 Agent 指令、记忆、灵魂价值观与自定义技能套路。文件按需挂载至 Agent 上下文。\n`
    case 'memory':
    case 'memory/adventures.md':
      return `# memory / 情境记忆库\n\n- [探索日志] 阶段性地城探索记录与路线心得\n- [关键战斗] 精英怪与 Boss 战术回溯\n`
    case 'memory/lore.md':
      return `# memory/lore.md · 世界往事\n\n- 旅伴关于这片大陆的认知、重要回忆与未解身世之谜。\n- 过去的旅途中结识的故人与未竟的心愿。\n`
    case 'skills':
    case 'skills/chest_alert.md':
      return `# skills/chest_alert.md · 宝箱感知\n\n- 感知到周边 6 格内存在未开启宝箱时触发提示。\n- 在地图中探索时主动提醒玩家注意隐藏角落。\n`
    case 'skills/danger_care.md':
      return `# skills/danger_care.md · 危机看护\n\n- 全队任意成员生命值低于 35% 时紧急呼救。\n- 提醒使用恢复药剂或退避休整。\n`
    case 'skills/banter.md':
      return `# skills / 伴侣技能套路\n\n- \`chest_alert\`：感知到周边 6 格内存在未开启宝箱时触发提示\n- \`danger_care\`：全队任意成员生命值低于 35% 时紧急呼救\n- \`idle_banter\`：待机休闲时自然生成对话并记录到台词池\n`
    default:
      return `# ${fileKey}\n\n(按需编辑内容)\n`
  }
}

export function generateCompanionIdleLine(role: Pick<AiRole, 'id' | 'name' | 'gender' | 'description'>): CompanionDialogueLine {
  const charId = role.id.toLowerCase() as CompanionCharacter
  const bank = DEFAULT_IDLE_LINES[charId] || [
    `${role.name} 轻轻环顾四周，看起来心情很放松。`,
    `“前面的路还很长，我们按自己的节奏来就好。”`,
    `“有什么需要随时跟我说，我一直都在。”`,
    `“这附近的风景真不错，走慢一点也无妨呢。”`,
  ]
  const text = bank[Math.floor(Math.random() * bank.length)]
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    scene: 'idle',
    text,
    createdAt: Date.now(),
  }
}

export function defaultAiRoles(): AiRole[] {
  const words = companionWords('zh')
  return COMPANION_CHARACTERS.map((charId) => {
    const profile = COMPANION_CHARACTER_PROFILES[charId]
    const lines = words.lines[charId]
    const idleList = DEFAULT_IDLE_LINES[charId] || []
    const dialogueLines: CompanionDialogueLine[] = [
      { id: `${charId}-chest`, scene: 'chest', text: lines?.chest || '发现宝箱！', createdAt: Date.now() },
      { id: `${charId}-battle`, scene: 'battle', text: lines?.battle || '战斗开始！', createdAt: Date.now() },
      { id: `${charId}-danger`, scene: 'danger', text: lines?.danger || '注意生命值！', createdAt: Date.now() },
      ...idleList.map((text, i) => ({ id: `${charId}-idle-${i}`, scene: 'idle' as const, text, createdAt: Date.now() })),
    ]
    return {
      id: charId,
      name: words.names[charId] || charId,
      gender: 'female',
      avatar: charId,
      description: profile.style,
      provider: '' as GameAgentProvider,
      model: '',
      lines: dialogueLines,
      idleLineGeneration: true,
      chestLine: lines?.chest || '',
      battleLine: lines?.battle || '',
      dangerLine: lines?.danger || '',
      builtin: true,
    }
  })
}

export function loadAiRoles(): AiRole[] {
  if (typeof window === 'undefined') return defaultAiRoles()
  try {
    const raw = localStorage.getItem(AI_ROLES_STORAGE_KEY)
    if (!raw) return defaultAiRoles()
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item) => {
        const id = String(item.id || '')
        const defaultChar = COMPANION_CHARACTERS.includes(id as CompanionCharacter) ? (id as CompanionCharacter) : null
        const words = companionWords('zh')
        const fallbackName = defaultChar ? words.names[defaultChar] : id
        const rawName = String(item.name || fallbackName || '')
        // Strip any legacy ' · 性格' suffix
        const cleanName = rawName.split(' · ')[0].trim() || rawName
        const chestLine = typeof item.chestLine === 'string' ? item.chestLine : ''
        const battleLine = typeof item.battleLine === 'string' ? item.battleLine : ''
        const dangerLine = typeof item.dangerLine === 'string' ? item.dangerLine : ''
        let lines: CompanionDialogueLine[] = Array.isArray(item.lines) ? item.lines : []
        if (!lines.length && (chestLine || battleLine || dangerLine)) {
          lines = [
            ...(chestLine ? [{ id: `${id}-c`, scene: 'chest' as const, text: chestLine }] : []),
            ...(battleLine ? [{ id: `${id}-b`, scene: 'battle' as const, text: battleLine }] : []),
            ...(dangerLine ? [{ id: `${id}-d`, scene: 'danger' as const, text: dangerLine }] : []),
          ]
        }
        if (!lines.length && defaultChar && DEFAULT_IDLE_LINES[defaultChar]) {
          lines = DEFAULT_IDLE_LINES[defaultChar].map((t, idx) => ({ id: `${id}-idle-${idx}`, scene: 'idle' as const, text: t }))
        }
        return {
          id,
          name: cleanName,
          gender: (item.gender === 'male' || item.gender === 'female' || item.gender === 'other' ? item.gender : 'female') as CompanionGender,
          avatar: typeof item.avatar === 'string' && item.avatar ? item.avatar : defaultChar || 'rin',
          description: String(item.description || ''),
          provider: (typeof item.provider === 'string' ? item.provider : '') as GameAgentProvider,
          model: typeof item.model === 'string' ? item.model : '',
          lines,
          idleLineGeneration: item.idleLineGeneration !== false,
          workspaceFiles: typeof item.workspaceFiles === 'object' && item.workspaceFiles ? item.workspaceFiles : undefined,
          tag: typeof item.tag === 'string' ? item.tag : undefined,
          chestLine,
          battleLine,
          dangerLine,
          builtin: Boolean(item.builtin),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
        }
      })
    }
  } catch {
    // ignore corrupt data
  }
  return defaultAiRoles()
}

export function saveAiRole(role: AiRole): AiRole[] {
  const current = loadAiRoles()
  const index = current.findIndex((item) => item.id === role.id)
  const updated: AiRole = { ...role, updatedAt: Date.now() }
  let next: AiRole[]
  if (index >= 0) {
    next = [...current]
    next[index] = updated
  } else {
    next = [...current, updated]
  }
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(AI_ROLES_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // In case localStorage quota is exceeded due to workspaceFiles, strip them from local cache
      try {
        const lightweight = next.map(({ workspaceFiles: _f, ...r }) => r)
        localStorage.setItem(AI_ROLES_STORAGE_KEY, JSON.stringify(lightweight))
      } catch {
        // LocalStorage unavailable
      }
    }
    window.dispatchEvent(new CustomEvent(AI_ROLES_EVENT))
    if (typeof fetch === 'function') {
      void fetch('/api/game-agent/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', role: updated, files: updated.workspaceFiles }),
      }).catch(() => {})
    }
  }
  return next
}

export function deleteAiRole(id: string): AiRole[] {
  const current = loadAiRoles()
  const next = current.filter((item) => item.id !== id)
  if (typeof window !== 'undefined') {
    localStorage.setItem(AI_ROLES_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(AI_ROLES_EVENT))
    if (typeof fetch === 'function') {
      void fetch(`/api/game-agent/roles?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }
  }
  return next
}

export async function syncAiRolesFromRemote(): Promise<AiRole[]> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return loadAiRoles()
  try {
    const res = await fetch('/api/game-agent/roles')
    if (res.ok) {
      const data = (await res.json()) as { roles?: AiRole[] }
      if (Array.isArray(data.roles) && data.roles.length > 0) {
        localStorage.setItem(AI_ROLES_STORAGE_KEY, JSON.stringify(data.roles))
        window.dispatchEvent(new CustomEvent(AI_ROLES_EVENT))
        return data.roles
      }
      const local = loadAiRoles()
      if (local.length > 0) {
        void fetch('/api/game-agent/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import', roles: local }),
        }).catch(() => {})
      }
    }
  } catch {}
  return loadAiRoles()
}

export function subscribeAiRoles(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(AI_ROLES_EVENT, listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === AI_ROLES_STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(AI_ROLES_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}
