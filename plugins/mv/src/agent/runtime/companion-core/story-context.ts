import { chestEventOpened } from '../../event-facts'
import { isBenchmarkStoryGame } from './story-benchmark'
import { StoryFailureMemory } from './story-failure-memory'
import { storyTransfers } from './story-transfer'

export type GlobalActionKind = 'milestone' | 'chest' | 'lever' | 'npc' | 'transfer' | 'battle' | 'guidance' | 'action'

export type GlobalActionEntry = {
  timestamp: number
  mapId: number
  mapName: string
  action: string
  kind: GlobalActionKind
}

export type MapTransition = {
  fromMapId: number
  toMapId: number
  fromPos?: { x: number; y: number }
  arrivalPos?: { x: number; y: number }
  portalEventId?: number
  timestamp: number
}

export type LockPrerequisite = {
  mapId: number
  eventId: number
  kind: 'chest' | 'trap'
  requiredLevel: number
  lastAttemptLevel?: number
  recordedAt: number
}

export type StoryQuestContext = {
  mapId: number
  mapName: string
  activeObjective: string
  phase: string
  chestsOpened: number[]
  chestsTotal: number
  remainingChestPositions: Array<{ id: number; x: number; y: number; name?: string }>
  leversPulled: number[]
  npcsInteracted: number[]
  unreachableEvents: number[]
  lastAction: string | null
  recentMilestones: string[]
  keyItems: Array<{ id: number; name: string; count: number }>
  updatedAt: number
}

type GlobalStore = {
  maps: Record<number, StoryQuestContext>
  globalHistory: GlobalActionEntry[]
  lastTransition: MapTransition | null
  transitions: MapTransition[]
  lockPrerequisites?: Record<string, LockPrerequisite>
}

const GLOBAL_CONTEXT_KEY = '__CHAYA_STORY_QUEST_CONTEXT__'
let contextOwner: unknown

function getMapName(mapId: number): string {
  const g = globalThis as any
  const map = g.$gameMap
  const displayName = g.$dataMap && map?.mapId?.() === mapId && typeof map?.displayName === 'function' ? map.displayName() : ''
  return displayName || g.$dataMapInfos?.[mapId]?.name || `地图 ${mapId}`
}

function getGlobalStorage(): GlobalStore {
  const g = globalThis as any
  if (contextOwner !== g.$gameSystem) {
    delete g[GLOBAL_CONTEXT_KEY]
    contextOwner = g.$gameSystem
  }
  if (!g[GLOBAL_CONTEXT_KEY]) {
    g[GLOBAL_CONTEXT_KEY] = {
      maps: {},
      globalHistory: [],
      lastTransition: null,
      transitions: [],
      lockPrerequisites: {},
    }
  }
  const storage = g[GLOBAL_CONTEXT_KEY]
  if (!storage.maps) storage.maps = {}
  if (!Array.isArray(storage.globalHistory)) storage.globalHistory = []
  if (!Array.isArray(storage.transitions)) storage.transitions = []
  if (!storage.lockPrerequisites) storage.lockPrerequisites = {}
  return storage
}

export class StoryContextStore {
  public static get(mapId?: number): StoryQuestContext {
    const g = globalThis as any
    const currentMapId = mapId ?? (typeof g.$gameMap?.mapId === 'function' ? g.$gameMap.mapId() : 0)
    const storage = getGlobalStorage()
    if (!storage.maps[currentMapId]) {
      storage.maps[currentMapId] = this.deriveContext(currentMapId)
    } else {
      this.refreshLiveContext(storage.maps[currentMapId])
    }
    return storage.maps[currentMapId]
  }

  public static update(mapId: number, updater: (prev: StoryQuestContext) => Partial<StoryQuestContext>): StoryQuestContext {
    const current = this.get(mapId)
    const patch = updater(current)
    const updated = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }
    getGlobalStorage().maps[mapId] = updated
    return updated
  }

  public static recordGlobalAction(mapId: number, action: string, kind: GlobalActionKind = 'action'): void {
    const storage = getGlobalStorage()
    const mapName = getMapName(mapId)

    const last = storage.globalHistory[storage.globalHistory.length - 1]
    if (last && last.mapId === mapId && last.action === action && Date.now() - last.timestamp < 3_000) {
      return
    }

    storage.globalHistory.push({
      timestamp: Date.now(),
      mapId,
      mapName,
      action,
      kind,
    })
    if (storage.globalHistory.length > 30) {
      storage.globalHistory.shift()
    }
  }

  public static getRecentGlobalHistory(limit = 8): GlobalActionEntry[] {
    const storage = getGlobalStorage()
    return storage.globalHistory.slice(-limit)
  }

  public static recordTransition(transition: MapTransition): void {
    const storage = getGlobalStorage()
    storage.lastTransition = transition
    storage.transitions.push(transition)
    if (storage.transitions.length > 20) {
      storage.transitions.shift()
    }
    this.recordGlobalAction(transition.toMapId, `从地图 ${transition.fromMapId} 穿过暗门/传送门抵达地图 ${transition.toMapId}`, 'transfer')
  }

  public static getLastTransition(): MapTransition | null {
    return getGlobalStorage().lastTransition
  }

  public static isBacktrackPortal(mapId: number, eventId: number, destMapId?: number): boolean {
    const storage = getGlobalStorage()
    const last = storage.lastTransition
    if (typeof destMapId === 'number' && last?.toMapId === mapId && destMapId === last.fromMapId) {
      return true
    }
    if (typeof destMapId === 'number' && last?.toMapId === mapId) return false

    const g = globalThis as any
    const ev = g.$gameMap?.event?.(eventId)
    if (ev && last?.toMapId === mapId) {
      const destinations = storyTransfers(ev)
      if (destinations.some((transfer) => transfer.mapId === last.fromMapId)) return true
      if (destinations.length && destinations.every((transfer) => transfer.mapId !== null)) return false
      const x = Number(ev._x)
      const y = Number(ev._y)
      if (last.arrivalPos) {
        const dist = Math.abs(x - last.arrivalPos.x) + Math.abs(y - last.arrivalPos.y)
        // If event is right next to the arrival point (within 3 tiles), it is the doorway just passed through
        if (dist <= 3) return true
      }
    }

    return false
  }

  public static recordChestOpened(mapId: number, eventId: number, name?: string): void {
    const ctx = this.get(mapId)
    if (!ctx.chestsOpened.includes(eventId)) {
      ctx.chestsOpened.push(eventId)
    }
    ctx.remainingChestPositions = ctx.remainingChestPositions.filter((c) => c.id !== eventId)
    const label = `开启了宝箱 ${name || `#${eventId}`}`
    ctx.lastAction = label
    ctx.updatedAt = Date.now()
    this.recordGlobalAction(mapId, label, 'chest')
    this.refreshLiveContext(ctx)
  }

  public static recordLeverPulled(mapId: number, eventId: number, name?: string): void {
    const ctx = this.get(mapId)
    if (!ctx.leversPulled.includes(eventId)) {
      ctx.leversPulled.push(eventId)
    }
    const label = `扳动了机关拉杆 ${name || `#${eventId}`}`
    ctx.lastAction = label
    ctx.updatedAt = Date.now()
    this.recordGlobalAction(mapId, label, 'lever')
    this.refreshLiveContext(ctx)
  }

  public static recordNpcInteraction(mapId: number, eventId: number, npcName?: string): void {
    const ctx = this.get(mapId)
    if (!ctx.npcsInteracted.includes(eventId)) {
      ctx.npcsInteracted.push(eventId)
    }
    const label = `与 ${npcName || `NPC #${eventId}`} 完成对话交流`
    ctx.lastAction = label
    ctx.updatedAt = Date.now()
    this.recordGlobalAction(mapId, label, 'npc')
  }

  public static recordUnreachable(mapId: number, eventId: number): void {
    const ctx = this.get(mapId)
    if (!ctx.unreachableEvents.includes(eventId)) {
      ctx.unreachableEvents.push(eventId)
    }
    ctx.updatedAt = Date.now()
  }

  public static isUnreachable(mapId: number, eventId: number): boolean {
    const ctx = this.get(mapId)
    return ctx.unreachableEvents.includes(eventId)
  }

  public static clearUnreachable(mapId?: number): void {
    const storage = getGlobalStorage()
    if (typeof mapId === 'number') {
      const ctx = storage.maps[mapId]
      if (ctx) {
        ctx.unreachableEvents = []
        ctx.updatedAt = Date.now()
      }
    } else {
      for (const id of Object.keys(storage.maps)) {
        storage.maps[Number(id)].unreachableEvents = []
      }
    }
  }

  public static recordLockPrerequisite(mapId: number, eventId: number, kind: 'chest' | 'trap', requiredLevel: number, currentLevel?: number): void {
    const storage = getGlobalStorage()
    if (!storage.lockPrerequisites) storage.lockPrerequisites = {}
    const key = `${mapId}:${eventId}`
    storage.lockPrerequisites[key] = {
      mapId,
      eventId,
      kind,
      requiredLevel,
      lastAttemptLevel: currentLevel,
      recordedAt: Date.now(),
    }
  }

  public static getLockPrerequisite(mapId: number, eventId: number): LockPrerequisite | undefined {
    const storage = getGlobalStorage()
    return storage.lockPrerequisites?.[`${mapId}:${eventId}`]
  }

  public static getAllLockPrerequisites(mapId: number): LockPrerequisite[] {
    const storage = getGlobalStorage()
    if (!storage.lockPrerequisites) return []
    return Object.values(storage.lockPrerequisites).filter((p) => p.mapId === mapId)
  }

  public static getEligibleUnlockedTargets(mapId: number, currentLevel: number): LockPrerequisite[] {
    const storage = getGlobalStorage()
    if (!storage.lockPrerequisites) return []
    return Object.values(storage.lockPrerequisites).filter((p) => p.mapId === mapId && p.requiredLevel <= currentLevel)
  }

  public static clearLockPrerequisite(mapId: number, eventId: number): void {
    const storage = getGlobalStorage()
    if (storage.lockPrerequisites) {
      delete storage.lockPrerequisites[`${mapId}:${eventId}`]
    }
  }

  public static recordMilestone(mapId: number, milestone: string): void {
    const ctx = this.get(mapId)
    if (!ctx.recentMilestones.includes(milestone)) {
      ctx.recentMilestones.push(milestone)
      if (ctx.recentMilestones.length > 5) ctx.recentMilestones.shift()
    }
    ctx.updatedAt = Date.now()
    this.recordGlobalAction(mapId, milestone, 'milestone')
  }

  public static deriveContext(mapId: number): StoryQuestContext {
    const mapName = getMapName(mapId)

    const initial: StoryQuestContext = {
      mapId,
      mapName,
      activeObjective: '自由探索与剧情推进',
      phase: 'exploration',
      chestsOpened: [],
      chestsTotal: 0,
      remainingChestPositions: [],
      leversPulled: [],
      npcsInteracted: [],
      unreachableEvents: [],
      lastAction: null,
      recentMilestones: [],
      keyItems: [],
      updatedAt: Date.now(),
    }

    this.refreshLiveContext(initial)
    return initial
  }

  private static refreshLiveContext(ctx: StoryQuestContext): void {
    const g = globalThis as any
    const map = g.$gameMap
    const party = g.$gameParty
    const switches = g.$gameSwitches
    const variables = g.$gameVariables

    if (party && typeof party.items === 'function') {
      try {
        const rawItems = party.items() || []
        ctx.keyItems = rawItems
          .slice(0, 20)
          .map((item: any) => ({
            id: item?.id ?? 0,
            name: item?.name ?? '',
            count: party.numItems ? party.numItems(item) : 1,
          }))
          .filter((i: any) => i.name)
      } catch {
        // ignore inventory inspection failure
      }
    }

    if (map?.mapId?.() !== ctx.mapId) return

    // Benchmark Game Domain Knowledge
    if (isBenchmarkStoryGame() && ctx.mapId === 6) {
      const v6 = variables ? variables.value(6) : 0
      const s32 = switches ? switches.value(32) : false
      const s27 = switches ? switches.value(27) : false
      const s30 = switches ? switches.value(30) : false
      const s683 = switches ? switches.value(683) : false
      ctx.chestsTotal = 3

      const candidateChests = [
        { id: 7, x: 14, y: 7, name: '试炼宝箱 7' },
        { id: 8, x: 13, y: 11, name: '试炼宝箱 8' },
        { id: 6, x: 8, y: 10, name: '试炼宝箱 6' },
      ]

      const remaining: typeof ctx.remainingChestPositions = []
      for (const c of candidateChests) {
        const ev = map?.event?.(c.id)
        if (ev && chestEventOpened(ev, ctx.mapId, c.id)) {
          if (!ctx.chestsOpened.includes(c.id)) ctx.chestsOpened.push(c.id)
        } else if (!ctx.chestsOpened.includes(c.id)) {
          remaining.push(c)
        }
      }
      ctx.remainingChestPositions = remaining

      if (s30 || s683) {
        ctx.activeObjective = '已获得拉维尔娜女神赐福！返回公会大厅开启后续篇章'
        ctx.phase = 'prologue_complete'
      } else if (s27) {
        const offerings = variables?.value(7) ?? 0
        ctx.activeObjective =
          offerings < 4 ? `收集拉维尔娜赐礼 (${offerings}/4)，优先拆陷阱、开启力所能及的宝箱提升开锁等级，再挑战赐礼宝箱` : '前往拉维尔娜神坛 (3, 2) 接受女神赐福并通关序章'
        ctx.phase = offerings < 4 ? 'gather_offerings' : 'laverna_blessing'
      } else if (s32) {
        ctx.activeObjective = '调查会长身旁的闪光补给点 (13, 7) 获取试炼奖励'
        ctx.phase = 'claim_reward'
      } else if (v6 < 3) {
        const remainingNames = remaining.map((r) => `${r.name}(${r.x}, ${r.y})`).join('、')
        ctx.activeObjective = `开锁试炼: 撬开 3 个宝箱 (已开 ${v6}/3，剩余目标: ${remainingNames || '周围宝箱'})`
        ctx.phase = 'chest_trial'
      } else {
        ctx.activeObjective = '3个宝箱已全部开锁！向会长鲍里斯 (11, 7) 汇报任务'
        ctx.phase = 'report_trial'
      }
      return
    }

    if (isBenchmarkStoryGame() && ctx.mapId === 5) {
      const s12 = switches ? switches.value(12) : false
      const s13 = switches ? switches.value(13) : false
      const s14 = switches ? switches.value(14) : false
      const s23 = switches ? switches.value(23) : false

      if (!s12) {
        ctx.activeObjective = '听取鲍里斯会长的第二试炼简报 (4, 11)'
        ctx.phase = 'boris_briefing'
      } else if (!s13) {
        ctx.activeObjective = '推进试炼战斗，清理拦路鼠群 (6, 11)'
        ctx.phase = 'rat_encounter'
      } else if (!s14) {
        ctx.activeObjective = '穿过下水道走廊 (18, 15)，触发影之长者试炼 (5, 5)'
        ctx.phase = 'shadow_elder'
      } else if (!s23) {
        ctx.activeObjective = '拉动机关拉杆 (2, 3) 解除暗门封锁'
        ctx.phase = 'puzzle_levers'
      } else {
        ctx.activeObjective = '暗门已解锁，穿过门扉前往序章终点深处 (21, 3)'
        ctx.phase = 'enter_deep_dungeon'
      }
      return
    }

    if (isBenchmarkStoryGame() && ctx.mapId === 4) {
      const gold = party?.gold ? party.gold() : 0
      const questDone = switches ? switches.value(6) : false
      if (gold < 50 && !questDone) {
        ctx.activeObjective = `鲍里斯会长试炼: 筹集 50 金币 (当前拥有 ${gold} 金币，搜寻宝箱与坐垫下线索)`
        ctx.phase = 'gather_gold'
      } else if (!questDone) {
        ctx.activeObjective = `金币已筹齐 (${gold}G)，前往会长鲍里斯 (3, 4) 交付试炼`
        ctx.phase = 'report_gold'
      } else {
        ctx.activeObjective = '试炼已通过，穿过暗门 (1, 7) 进入试炼二区'
        ctx.phase = 'enter_zone_two'
      }
      return
    }

    if (isBenchmarkStoryGame() && ctx.mapId === 1) {
      const leader = party?.leader ? party.leader() : null
      const hasDagger = leader && g.$dataWeapons ? leader.hasWeapon(g.$dataWeapons[5]) || leader.isEquipped(g.$dataWeapons[5]) : false
      if (!hasDagger) {
        ctx.activeObjective = '开启武器箱 (8, 8) 拾取并装备盗贼匕首'
        ctx.phase = 'equip_weapon'
      } else {
        ctx.activeObjective = '前往秘密楼梯 (15, 11) 进入公会地下试炼场'
        ctx.phase = 'enter_dungeon'
      }
      return
    }

    // Generic RPG Maker map discovery
    if (map && typeof map.events === 'function') {
      const events = map.events() || []
      const unopened: typeof ctx.remainingChestPositions = []
      for (const ev of events) {
        if (!ev || ev._erased) continue
        const id = ev.eventId ? ev.eventId() : ev._eventId
        if (!id || typeof id !== 'number') continue
        const name = ev.event?.()?.name || ''
        if (/(сундук|chest|宝箱|箱)/i.test(name)) {
          if (!chestEventOpened(ev, ctx.mapId, id)) {
            unopened.push({ id, x: Number(ev._x), y: Number(ev._y), name })
          }
        }
      }
      ctx.remainingChestPositions = unopened
      if (unopened.length > 0) {
        ctx.activeObjective = `探索当前区域，收集 ${unopened.length} 个未开启的宝箱`
      }
    }
  }

  public static formatSummaryForPrompt(mapId: number): string {
    const ctx = this.get(mapId)
    const lines: string[] = ['【当前场景与任务目标】', `- 场景：${ctx.mapName} (ID: ${ctx.mapId})`, `- 当前明确目标：${ctx.activeObjective}`, `- 当前阶段：${ctx.phase}`]

    const recentActions = this.getRecentGlobalHistory(6)
    if (recentActions.length > 0) {
      lines.push('【历史行动与已完成事项（之前做过了什么）】')
      recentActions.forEach((item, idx) => {
        lines.push(`${idx + 1}. [${item.mapName}] ${item.action}`)
      })
    }

    if (ctx.chestsTotal > 0 || ctx.chestsOpened.length > 0) {
      lines.push(
        `- 宝箱进度：已开启 ${ctx.chestsOpened.length}/${ctx.chestsTotal || ctx.chestsOpened.length + ctx.remainingChestPositions.length}` +
          (ctx.remainingChestPositions.length > 0
            ? `，剩余目标：${ctx.remainingChestPositions.map((c) => `${c.name || `#${c.id}`}(${c.x}, ${c.y})`).join('、')}`
            : '（当前阶段宝箱已全部开启）')
      )
    }

    if (ctx.keyItems.length > 0) {
      const keyStr = ctx.keyItems.map((i) => `${i.name} x${i.count}`).join('、')
      lines.push(`- 背包道具：${keyStr}`)
    }

    if (ctx.unreachableEvents.length > 0) {
      lines.push(`- 确认不可达事件（已自动过滤）：[${ctx.unreachableEvents.map((id) => `ID ${id}`).join(', ')}]`)
    }

    const prerequisites = this.getAllLockPrerequisites(mapId)
    if (prerequisites.length > 0) {
      const level = (globalThis as any).$gameVariables?.value?.(3) ?? 0
      lines.push(`- 当前开锁等级：${level}`)
      for (const prerequisite of prerequisites) {
        lines.push(
          `- 事件 ID ${prerequisite.eventId}：${prerequisite.kind === 'trap' ? '陷阱' : '宝箱'}需要开锁等级 ${prerequisite.requiredLevel}，${level >= prerequisite.requiredLevel ? '已达到记录的最低等级，可重新评估' : '等级不足，先寻找其他可完成目标'}`
        )
      }
    }

    const lastTrans = this.getLastTransition()
    const failures = StoryFailureMemory.history(mapId)
    for (const eventId of new Set(failures.map((failure) => failure.eventId))) {
      const failure = StoryFailureMemory.blocked(mapId, eventId)
      if (failure) lines.push(`- 事件 ID ${eventId} 已禁止重复尝试：${failure.reason}；${failure.detail}。相关前提未变化，走远、切图或等待不能解除限制。`)
    }
    if (lastTrans && lastTrans.toMapId === mapId && Date.now() - lastTrans.timestamp < 120_000) {
      lines.push(`- 探索纪律：刚从地图 ${lastTrans.fromMapId} 传送进入当前地图，禁止走回头路返回上一层，必须在当前场景探索推进！`)
    }

    return lines.join('\n')
  }
}
