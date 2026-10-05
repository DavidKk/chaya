export type ItemKind = 'item' | 'weapon' | 'armor'

/** 角色编辑草稿（网页会话预览 / 局内同步） */
export type ActorDraft = {
  name: string
  nickname: string
  profile: string
  level: number
  exp: number
  hp: number
  mp: number
  mhp: number
  mmp: number
  atk: number
  def: number
  mat: number
  mdf: number
  agi: number
  luk: number
  classId: number
  skillIds: number[]
  stateIds: number[]
}

/** 运行页开关（与金钱/倍速并列） */
export const RUN_FLAG_KEYS = [
  'fullscreen',
  'alwaysDash',
  'god',
  'through',
  'autotalk',
  'encounter',
  'menuEnabled',
  'saveEnabled',
  'clickMove',
  'followers',
  'clickTeleport',
  'resourceSkip',
] as const
export type RunFlagKey = (typeof RUN_FLAG_KEYS)[number]

export const RUN_ACTION_IDS = [
  'scene:status',
  'scene:equip',
  'scene:skill',
  'scene:item',
  'scene:menu',
  'scene:load',
  'scene:save',
  'scene:options',
  'scene:debug',
  'scene:pop',
  'fix:clearPictures',
  'fix:clearEvent',
  'fix:clearMoveRoute',
  'fix:closeWindows',
  'fix:title',
  'fix:map',
  'fix:fadeIn',
  'fix:resume',
  'battle:victory',
  'battle:escape',
  'battle:defeat',
  'battle:abort',
  'battle:enemyHp1',
  'battle:enemyHpMax',
  'battle:partyHeal',
  'battle:partyHp1',
  'battle:partyHp0',
] as const
export type RunActionId = (typeof RUN_ACTION_IDS)[number]

export type SessionState = {
  gold: number
  counts: Record<string, number>
  vars: Record<number, number>
  switches: Record<number, boolean>
  /** 锁死：key → 锁定目标值；存在即防游戏改动（面板仍可改并更新该值） */
  locks: Record<string, number>
  actors: Record<number, ActorDraft>
  walkRate: number
  runRate: number
  /** Whole-game update speed; 1 = normal */
  gameSpeed: number
  fullscreen: boolean
  alwaysDash: boolean
  god: boolean
  through: boolean
  autotalk: boolean
  encounter: boolean
  menuEnabled: boolean
  saveEnabled: boolean
  clickMove: boolean
  followers: boolean
  clickTeleport: boolean
  resourceSkip: boolean
  expRate: number
  /** 本游戏快捷键覆盖；缺省或空表示继承全局 */
  hotkeys: Record<string, string>
  /** 全部游戏默认快捷键 */
  hotkeysGlobal: Record<string, string>
}

export const MAX_ROWS = 400

export const ACTOR_PARAM_FIELDS = [
  { key: 'mhp', label: '最大 HP' },
  { key: 'mmp', label: '最大 MP' },
  { key: 'atk', label: '攻击' },
  { key: 'def', label: '防御' },
  { key: 'mat', label: '魔攻' },
  { key: 'mdf', label: '魔防' },
  { key: 'agi', label: '敏捷' },
  { key: 'luk', label: '幸运' },
] as const satisfies ReadonlyArray<{ key: keyof ActorDraft; label: string }>

export function defaultActorDraft(id: number, name = ''): ActorDraft {
  return {
    name: name || `角色 #${id}`,
    nickname: '',
    profile: '',
    level: 1,
    exp: 0,
    hp: 1,
    mp: 0,
    mhp: 1,
    mmp: 0,
    atk: 1,
    def: 1,
    mat: 1,
    mdf: 1,
    agi: 1,
    luk: 1,
    classId: 1,
    skillIds: [],
    stateIds: [],
  }
}

export function countKey(kind: ItemKind, id: number) {
  return `${kind}:${id}`
}

export function lockKeyForCount(kind: ItemKind, id: number) {
  return countKey(kind, id)
}

export function lockKeyForVar(id: number) {
  return `var:${id}`
}

export function lockKeyForSwitch(id: number) {
  return `sw:${id}`
}

export function lockKeyForActorSkill(actorId: number, skillId: number) {
  return `actorSkill:${actorId}:${skillId}`
}

export function lockKeyForActorState(actorId: number, stateId: number) {
  return `actorState:${actorId}:${stateId}`
}

/** 角色数值锁：等级 / 经验 / HP / MP（与 Cheats LockKind 同形 `kind:actorId`） */
export type ActorVitalLockKind = 'level' | 'exp' | 'hp' | 'mp'

export function lockKeyForActorVital(kind: ActorVitalLockKind, actorId: number) {
  return `${kind}:${actorId}`
}

export const GOLD_LOCK_KEY = 'gold:0'

export function matchFilter(text: string, q: string) {
  if (!q) return true
  return text.toLowerCase().includes(q)
}

/** 目录名非空（去空白）；「仅有名」筛选用 */
export function hasCatalogName(name: string | null | undefined) {
  return String(name ?? '').trim().length > 0
}

export function emptySession(): SessionState {
  return {
    gold: 0,
    counts: {},
    vars: {},
    switches: {},
    locks: {},
    actors: {},
    walkRate: 1,
    runRate: 1,
    gameSpeed: 1,
    fullscreen: false,
    alwaysDash: false,
    god: false,
    through: false,
    autotalk: false,
    encounter: true,
    menuEnabled: true,
    saveEnabled: true,
    clickMove: true,
    followers: true,
    clickTeleport: false,
    resourceSkip: false,
    expRate: 1,
    hotkeys: {},
    hotkeysGlobal: {},
  }
}

export type TableRow = {
  id: number
  name: string
  meta?: string
  value: number | boolean | string
  kind?: ItemKind
  valueType: 'count' | 'var' | 'sw' | 'actor'
}
