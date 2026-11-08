import { planMapRoute } from '../../game-control'

export type StoryRetryCondition = {
  requiredLevel?: number
  requiresLockpick?: boolean
  blockerEventIds?: number[]
  navigation?: boolean
}

export function storyNavigationFacts(eventId: number) {
  const event = (globalThis as any).$gameMap?.event?.(eventId)
  if (!event) return null
  const target = { x: event._x, y: event._y }
  const positions =
    event.isNormalPriority?.() === false
      ? undefined
      : [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
  const route = planMapRoute(target, eventId, positions)
  return route ? [route.status === 'already_there' ? 'reachable' : route.status, [...route.eventBoundaryIds].sort((left, right) => left - right)] : null
}

function compare(left: number, right: number, operator: number): boolean {
  switch (operator) {
    case 0:
      return left === right
    case 1:
      return left >= right
    case 2:
      return left <= right
    case 3:
      return left > right
    case 4:
      return left < right
    case 5:
      return left !== right
    default:
      return false
  }
}

export function storyRetryFacts(mapId: number, eventId: number, condition: StoryRetryCondition = {}): string | null {
  const engine = globalThis as any
  if (engine.$gameMap?.mapId?.() !== mapId) return null
  const event = engine.$gameMap?.event?.(eventId)
  const data = event?.event?.()
  const facts: unknown[] = [event?._pageIndex ?? null, Boolean(event?._erased)]
  const variable = (id: number) => engine.$gameVariables?.value?.(id) ?? 0
  const hasItem = (kind: string, id: number, equipped = false) => Boolean(engine[kind]?.[id] && engine.$gameParty?.hasItem?.(engine[kind][id], equipped))
  for (const page of data?.pages ?? []) {
    const conditions = page.conditions
    if (!conditions) continue
    if (conditions.switch1Valid) facts.push(['switch', conditions.switch1Id, Boolean(engine.$gameSwitches?.value?.(conditions.switch1Id))])
    if (conditions.switch2Valid) facts.push(['switch', conditions.switch2Id, Boolean(engine.$gameSwitches?.value?.(conditions.switch2Id))])
    if (conditions.variableValid) facts.push(['variable', conditions.variableId, variable(conditions.variableId) >= conditions.variableValue])
    if (conditions.selfSwitchValid) facts.push(['selfSwitch', conditions.selfSwitchCh, Boolean(engine.$gameSelfSwitches?.value?.([mapId, eventId, conditions.selfSwitchCh]))])
    if (conditions.itemValid) facts.push(['item', conditions.itemId, hasItem('$dataItems', conditions.itemId)])
    if (conditions.actorValid) facts.push(['actor', conditions.actorId, Boolean(engine.$gameParty?.members?.().some((actor: any) => actor.actorId?.() === conditions.actorId))])
  }
  const commonEvents = new Set<number>()
  const branches: any[][] = []
  const assignments: Array<[number, number]> = []
  const scan = (list: any[], depth = 0) => {
    if (depth > 20) return
    for (const command of list) {
      const parameters = command?.parameters ?? []
      if (command?.code === 117 && !commonEvents.has(parameters[0])) {
        commonEvents.add(parameters[0])
        scan(engine.$dataCommonEvents?.[parameters[0]]?.list ?? [], depth + 1)
      }
      if (command?.code === 122) assignments.push([parameters[0], parameters[1]])
      if (command?.code === 111) branches.push(parameters)
    }
  }
  const list = event?.list?.() ?? []
  facts.push(list)
  scan(list)
  const assigned = (id: number) => assignments.some(([first, last]) => id >= first && id <= last)
  for (const [kind, id, operandType, value, operator] of branches) {
    if (kind === 0) facts.push(['switch', id, Boolean(engine.$gameSwitches?.value?.(id)) === (operandType === 0)])
    if (kind === 1 && !assigned(id) && (operandType === 0 || !assigned(value)))
      facts.push(['variable', id, compare(variable(id), operandType === 0 ? value : variable(value), operator)])
    if (kind === 2) facts.push(['selfSwitch', id, Boolean(engine.$gameSelfSwitches?.value?.([mapId, eventId, id])) === (operandType === 0)])
    if (kind === 7) facts.push(['gold', id, compare(engine.$gameParty?.gold?.() ?? 0, id, [1, 2, 4][operandType])])
    if ([8, 9, 10].includes(kind)) facts.push(['item', kind, id, hasItem(['$dataItems', '$dataWeapons', '$dataArmors'][kind - 8], id, Boolean(operandType))])
  }
  if (condition.requiredLevel !== undefined) facts.push(['lockLevel', condition.requiredLevel, variable(3) >= condition.requiredLevel])
  if (condition.requiresLockpick) facts.push(['lockpick', hasItem('$dataItems', 5)])
  for (const blockerId of condition.blockerEventIds ?? []) {
    const blocker = engine.$gameMap?.event?.(blockerId)
    facts.push(['blocker', blockerId, blocker?._pageIndex ?? null, Boolean(blocker?._erased), Boolean(blocker?.isThrough?.())])
  }
  if (condition.navigation) facts.push(['navigation', 2, storyNavigationFacts(eventId)])
  return JSON.stringify(facts)
}
