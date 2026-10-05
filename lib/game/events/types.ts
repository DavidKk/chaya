/** RPG Maker MV / MZ 事件数据：服务端读盘、网页、游戏插件共用。 */

export type EventCommand = { code: number; indent: number; parameters: unknown[] }

/** 0 无（只能被调用）· 1 自动执行 · 2 并行处理 */
export type CommonEventTrigger = 0 | 1 | 2

export type CommonEventInfo = {
  id: number
  /** 译名（无译文时为原名） */
  name: string
  rawName: string
  trigger: CommonEventTrigger
  /** 自动执行 / 并行处理的条件开关 */
  switchId: number
  list: EventCommand[]
  /** 指令条数，不含结尾 / 分支结束的空指令（code 0） */
  commandCount: number
}

export type EventRefKind = 'common' | 'map' | 'troop'

/** 调用某条公共事件的位置 */
export type EventRef = {
  kind: EventRefKind
  /** 公共事件 / 地图 / 敌群编号 */
  id: number
  name: string
  /** 地图事件编号与名称 */
  eventId?: number
  eventName?: string
  /** 事件页（从 1 起） */
  page?: number
}

/** 下标即编号；未命名为空串 */
export type EventNames = {
  switches: string[]
  variables: string[]
  items: string[]
  weapons: string[]
  armors: string[]
  actors: string[]
  maps: string[]
  commonEvents: string[]
  troops: string[]
}

export type CommonEventsData = {
  ok: true
  source: 'disk' | 'live'
  events: CommonEventInfo[]
  names: EventNames
  /** 指令中的对话 / 选项原文 → 译文（只收有译文的） */
  texts: Record<string, string>
  /** 公共事件编号 → 调用它的位置 */
  calledBy: Record<number, EventRef[]>
  /** 开关编号 → 引用它的位置（地图事件页条件、公共事件触发开关、条件分支、开关操作） */
  switchRefs: Record<number, EventRef[]>
  /** 是否提供了地图数据（未扫描时只含公共事件与敌群的引用） */
  mapsScanned: boolean
  /** 读取或解析失败的地图数；大于 0 时引用关系可能不完整 */
  mapsFailed: number
}
