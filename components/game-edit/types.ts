export type ItemKind = 'item' | 'weapon' | 'armor'

/** Actor edit draft for web previews and in-game synchronization. */
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
  inParty?: boolean
  skillIds: number[]
  stateIds: number[]
}

/** Runtime toggles displayed alongside gold and speed controls. */
export const RUN_FLAG_KEYS = [
  'fullscreen',
  'alwaysDash',
  'god',
  'autoWin',
  'autoBattle',
  'skipBattleResult',
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
  'fix:clearOverlay',
  'fix:clearEvent',
  'fix:clearMoveRoute',
  'fix:closeWindows',
  'fix:title',
  'fix:map',
  'fix:fadeIn',
  'fix:resume',
  'fix:unstuck',
  'fix:advanceCutscene',
  'fix:returnPrevMap',
  'battle:start',
  'battle:victory',
  'battle:escape',
  'battle:defeat',
  'battle:abort',
  'battle:settle',
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
  /** Map lock keys to target values; panel edits may update the target. */
  locks: Record<string, number>
  actors: Record<number, ActorDraft>
  walkRate: number
  runRate: number
  /** Whole-game update speed; 1 = normal */
  gameSpeed: number
  fullscreen: boolean
  alwaysDash: boolean
  god: boolean
  /** Win on entering battle until disabled. */
  autoWin: boolean
  /** Select battle commands automatically until disabled. */
  autoBattle: boolean
  /** Automatically confirm battle result screens. */
  skipBattleResult: boolean
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
  /** Per-game hotkey overrides; missing or empty values inherit global bindings. */
  hotkeys: Record<string, string>
  /** Default hotkeys shared by all games. */
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
    inParty: false,
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

/** Actor level, experience, HP and MP locks use the shared `kind:actorId` format. */
export type ActorVitalLockKind = 'level' | 'exp' | 'hp' | 'mp'

/** Additional battle actor locks; HP and MP share the actor editor's locks. */
export type BattleActorLockKind = ActorVitalLockKind | 'mhp' | 'mmp' | 'tp'

export function lockKeyForActorVital(kind: BattleActorLockKind, actorId: number) {
  return `${kind}:${actorId}`
}

export type BattleLockChange =
  { side: 'actor'; id: number; kind: BattleActorLockKind; on: boolean; value: number } | { side: 'enemy'; id: number; kind: 'hp' | 'mhp'; on: boolean; value: number }

export function battleLockKey(change: Pick<BattleLockChange, 'side' | 'id' | 'kind'>) {
  if (change.side === 'actor') return lockKeyForActorVital(change.kind, change.id)
  return change.kind === 'hp' ? `enemyHp:${change.id}` : `enemyMhp:${change.id}`
}

export const GOLD_LOCK_KEY = 'gold:0'

export function matchFilter(text: string, q: string) {
  if (!q) return true
  return text.toLowerCase().includes(q)
}

/** Check for a nonblank catalog name when filtering named entries. */
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
    alwaysDash: true,
    god: false,
    autoWin: false,
    autoBattle: false,
    skipBattleResult: true,
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
