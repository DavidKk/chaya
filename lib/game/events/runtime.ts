/** Serializable, read-only event diagnostics shared by the plugin and the local bridge. */
export type RuntimeInterpreter = {
  _list?: { code: number; indent: number; parameters: unknown[] }[] | null
  _index?: number
  _mapId?: number
  _eventId?: number
  _waitMode?: string
  _waitCount?: number
  _childInterpreter?: RuntimeInterpreter | null
  _character?: RuntimeCharacter | null
}

type RuntimeCharacter = {
  _eventId?: number
  _x?: number
  _y?: number
  _realX?: number
  _realY?: number
  _transparent?: boolean
  _moveRouteForcing?: boolean
  _moveRouteIndex?: number
  _moveRoute?: { repeat?: boolean; skippable?: boolean; wait?: boolean; list?: unknown[] } | null
}

export type RuntimeHost = {
  $gameMap?: {
    _mapId?: number
    _interpreter?: RuntimeInterpreter
    _events?: ({ _interpreter?: RuntimeInterpreter; _eventId?: number; _pageIndex?: number } | null)[]
    _commonEvents?: { _commonEventId?: number; _interpreter?: RuntimeInterpreter }[]
  }
  $gameTroop?: { _interpreter?: RuntimeInterpreter }
  $dataMap?: { events?: ({ id: number; name: string; pages: { list: unknown }[] } | null)[] }
  $dataCommonEvents?: ({ id: number; name: string; list: unknown } | null)[]
  $dataSystem?: { switches?: string[]; variables?: string[] }
  $gamePlayer?: RuntimeCharacter
  $gameMessage?: { _texts?: string[]; _choices?: string[]; _scrollMode?: boolean; clear?: () => void }
  $gameTemp?: { _stopMapPlayer?: boolean; _stopMapEvents?: boolean }
  $gameSwitches?: { _data?: boolean[] }
  $gameVariables?: { _data?: unknown[] }
  $gameScreen?: { _brightness?: number; brightness?: () => number }
}

export type RunningEvent = {
  path: string
  mapId: number
  eventId: number
  commonEventId: number | null
  page: number | null
  name: string
  index: number
  code: number | null
  previousCode: number | null
  waitMode: string
  waitCount: number
  child: boolean
  length: number
  command: unknown
  previousCommand: unknown
  route: {
    eventId: number
    x: number | null
    y: number | null
    forcing: boolean
    index: number
    repeat: boolean
    skippable: boolean
    command: unknown
  } | null
}

export type EventControlBlock = 'child' | 'message' | 'unsupported' | null
export type CurrentEvent = Pick<RunningEvent, 'path' | 'mapId' | 'eventId' | 'commonEventId' | 'page' | 'name' | 'index' | 'code' | 'previousCode' | 'waitMode' | 'child'> & {
  token: string
  waiting: boolean
  skipBlocked: EventControlBlock
  restartBlocked: EventControlBlock
  advanceBlocked: EventControlBlock
}
export type CandidateEvent = {
  mapId: number
  eventId: number
  page: number
  name: string
  trigger: number
  missingConditions: string[]
  missingSwitches?: number[]
  outcome?: {
    switches: { id: number; value: boolean }[]
    variables: { id: number; value: number }[]
    transfer: { mapId: number; x: number; y: number } | null
  }
}
export type EventActivity = {
  entries: CurrentEvent[]
  transparent: boolean
  movementLocked: boolean
  faded: boolean
  candidates: CandidateEvent[]
}
export type EventControlTarget = Pick<CurrentEvent, 'path' | 'token' | 'index' | 'waitMode' | 'waiting'>
export type EventControlAction = 'skip' | 'restart' | 'advance'

/** Self-contained so legacy local agents can run this fixed read-only probe. */
export function readEventRuntime(root: RuntimeHost = globalThis as unknown as RuntimeHost, details = true) {
  const map = root.$gameMap
  const common = root.$dataCommonEvents ?? []
  const events = root.$dataMap?.events ?? []
  const entries: RunningEvent[] = []
  const seen = new Set<RuntimeInterpreter>()
  const visit = (interpreter: RuntimeInterpreter | undefined | null, path: string, ownerCommon: number | null = null) => {
    if (!interpreter?._list || seen.has(interpreter) || entries.length >= 100) return
    seen.add(interpreter)
    const list = interpreter._list
    const ce = common.find((item) => item?.list === list)
    const eventId = interpreter._eventId ?? 0
    const mapId = interpreter._mapId ?? map?._mapId ?? 0
    const event = path !== 'troop' && !path.startsWith('troop/') && mapId === map?._mapId ? events[eventId] : null
    const page = event?.pages.findIndex((item) => item.list === list) ?? -1
    const index = interpreter._index ?? 0
    const character = interpreter._character
    const route = character?._moveRoute
    entries.push({
      path,
      mapId,
      eventId,
      commonEventId: ce?.id ?? ownerCommon,
      page: page >= 0 ? page : null,
      name: ce?.name ?? (ownerCommon ? common[ownerCommon]?.name : event?.name) ?? '',
      index,
      code: list[index]?.code ?? null,
      previousCode: list[index - 1]?.code ?? null,
      waitMode: interpreter._waitMode ?? '',
      waitCount: interpreter._waitCount ?? 0,
      child: !!interpreter._childInterpreter?._list,
      length: list.length,
      command: details ? (list[index] ?? null) : null,
      previousCommand: details ? (list[index - 1] ?? null) : null,
      route:
        details && character
          ? {
              eventId: character === root.$gamePlayer ? -1 : (character._eventId ?? 0),
              x: character._x ?? null,
              y: character._y ?? null,
              forcing: !!character._moveRouteForcing,
              index: character._moveRouteIndex ?? 0,
              repeat: !!route?.repeat,
              skippable: !!route?.skippable,
              command: route?.list?.[character._moveRouteIndex ?? 0] ?? null,
            }
          : null,
    })
    visit(interpreter._childInterpreter, `${path}/child`)
  }
  visit(map?._interpreter, 'map')
  for (const event of map?._events ?? []) visit(event?._interpreter, `event:${event?._eventId}`)
  for (const event of map?._commonEvents ?? []) visit(event._interpreter, `common:${event._commonEventId}`, event._commonEventId)
  visit(root.$gameTroop?._interpreter, 'troop')
  const player = root.$gamePlayer
  const mapId = map?._mapId ?? 0
  const faded = typeof root.$gameScreen?.brightness === 'function' ? root.$gameScreen.brightness() === 0 : (root.$gameScreen?._brightness ?? 255) === 0
  const runningEventIds = new Set(entries.map((e) => e.eventId))
  const candidates: CandidateEvent[] = []
  if (mapId > 0 && Array.isArray(events)) {
    for (const event of events) {
      if (!event || event.id <= 0 || runningEventIds.has(event.id)) continue
      const pages = event.pages ?? []
      for (let pageIdx = pages.length - 1; pageIdx >= 0; pageIdx--) {
        const page = pages[pageIdx] as { list?: unknown[]; trigger?: number; conditions?: Record<string, unknown> } | undefined
        if (!page?.list || page.list.length <= 1) continue
        const cond = page.conditions ?? {}
        const missing: string[] = []
        const missingSwitches: number[] = []
        if (cond.switch1Valid) {
          const swId = Number(cond.switch1Id)
          if (!root.$gameSwitches?._data?.[swId]) {
            missingSwitches.push(swId)
            const name = root.$dataSystem?.switches?.[swId]
            missing.push(name ? `#${swId} ${name}` : `#${swId}`)
          }
        }
        if (cond.switch2Valid) {
          const swId = Number(cond.switch2Id)
          if (!root.$gameSwitches?._data?.[swId]) {
            missingSwitches.push(swId)
            const name = root.$dataSystem?.switches?.[swId]
            missing.push(name ? `#${swId} ${name}` : `#${swId}`)
          }
        }
        if (cond.variableValid) {
          const varId = Number(cond.variableId)
          const curVal = Number(root.$gameVariables?._data?.[varId] ?? 0)
          const reqVal = Number(cond.variableValue ?? 0)
          if (curVal < reqVal) {
            const name = root.$dataSystem?.variables?.[varId]
            missing.push(name ? `#${varId} ${name} >= ${reqVal}` : `#${varId} >= ${reqVal}`)
          }
        }
        if (missing.length > 0 || page.trigger === 3 || page.trigger === 4) {
          const pageCommands = Array.isArray(page.list) ? page.list : []
          const outcomeSwitches: { id: number; value: boolean }[] = []
          const outcomeVariables: { id: number; value: number }[] = []
          let outcomeTransfer: { mapId: number; x: number; y: number } | null = null
          for (const rawCmd of pageCommands as { code?: number; parameters?: unknown[] }[]) {
            if (!rawCmd || !Array.isArray(rawCmd.parameters)) continue
            if (rawCmd.code === 121 && rawCmd.parameters.length >= 3) {
              const [start, end, val] = rawCmd.parameters as [number, number, number]
              for (let sid = start; sid <= end; sid++) outcomeSwitches.push({ id: sid, value: val === 0 })
            } else if (rawCmd.code === 122 && rawCmd.parameters.length >= 5) {
              const [start, end, op, operandType, operandVal] = rawCmd.parameters as [number, number, number, number, any]
              if (op === 0 && operandType === 0 && typeof operandVal === 'number') {
                for (let vid = start; vid <= end; vid++) outcomeVariables.push({ id: vid, value: operandVal })
              }
            } else if (rawCmd.code === 201 && rawCmd.parameters.length >= 4) {
              const [, tMapId, tX, tY] = rawCmd.parameters as [number, number, number, number]
              if (typeof tMapId === 'number' && tMapId > 0) outcomeTransfer = { mapId: tMapId, x: tX, y: tY }
            }
          }
          candidates.push({
            mapId,
            eventId: event.id,
            page: pageIdx,
            name: event.name || '',
            trigger: page.trigger ?? 0,
            missingConditions: missing,
            missingSwitches,
            outcome: {
              switches: outcomeSwitches,
              variables: outcomeVariables,
              transfer: outcomeTransfer,
            },
          })
          break
        }
      }
      if (candidates.length >= 20) break
    }
    candidates.sort((a, b) => {
      const pA = a.trigger === 3 ? 0 : a.trigger === 4 ? 1 : 2
      const pB = b.trigger === 3 ? 0 : b.trigger === 4 ? 1 : 2
      return pA - pB || a.eventId - b.eventId
    })
  }
  return {
    entries,
    player: player
      ? {
          x: player._x,
          y: player._y,
          realX: player._realX,
          realY: player._realY,
          transparent: !!player._transparent,
          routeForcing: !!player._moveRouteForcing,
        }
      : null,
    message: { texts: root.$gameMessage?._texts ?? [], choices: root.$gameMessage?._choices ?? [], scrolling: !!root.$gameMessage?._scrollMode },
    movementLocks: { player: root.$gameTemp?._stopMapPlayer, events: root.$gameTemp?._stopMapEvents },
    faded,
    candidates,
    pageConditions: (details ? events.filter((event) => !!event) : []).map((event) => ({
      eventId: event!.id,
      pages: event!.pages.map((page) => {
        const conditions = (page as { conditions?: Record<string, unknown> }).conditions ?? {}
        return {
          switch1: conditions.switch1Valid ? { id: conditions.switch1Id, value: !!root.$gameSwitches?._data?.[Number(conditions.switch1Id)] } : null,
          switch2: conditions.switch2Valid ? { id: conditions.switch2Id, value: !!root.$gameSwitches?._data?.[Number(conditions.switch2Id)] } : null,
          variable: conditions.variableValid
            ? { id: conditions.variableId, value: root.$gameVariables?._data?.[Number(conditions.variableId)], required: conditions.variableValue }
            : null,
        }
      }),
    })),
  }
}

export type EventRuntime = ReturnType<typeof readEventRuntime>
