type Loose = Record<string, unknown>

export const GAME_STATE_SECTIONS = ['map', 'party', 'inventory', 'equipment', 'ui', 'battle', 'text', 'all'] as const
export type GameStateSection = (typeof GAME_STATE_SECTIONS)[number]

/** Tool-facing state groups; omit unrelated domains unless explicitly requested. */
export function selectGameState(value: unknown, sections: readonly GameStateSection[] = []): unknown {
  if (!isObject(value) || sections.includes('all')) return value
  const selected: Loose = { scene: value.scene, title: value.title }
  const keys: Record<Exclude<GameStateSection, 'all' | 'equipment'>, string[]> = {
    map: ['map', 'player', 'nearbyEvents'],
    party: ['party', 'gold'],
    inventory: ['inventory', 'gold'],
    ui: ['windows', 'message', 'commandInputs'],
    battle: ['battle', 'lastBattleResult', 'reactionAvailable', 'qte', 'lastReaction', 'qteOutcome'],
    text: ['screenText', 'renderedText'],
  }
  for (const section of sections) {
    if (section === 'equipment' || section === 'all') continue
    for (const key of keys[section]) if (key in value) selected[key] = value[key]
  }
  if (sections.includes('equipment')) {
    if (!sections.includes('party') && Array.isArray(value.party)) {
      selected.party = value.party.filter(isObject).map((member) => ({ id: member.id, name: member.name, equipment: member.equipment }))
    }
    if (!sections.includes('inventory') && isObject(value.inventory)) selected.inventory = { weapons: value.inventory.weapons, armors: value.inventory.armors }
  }
  if (!sections.length) selected.availableSections = GAME_STATE_SECTIONS.filter((section) => section !== 'all')
  return selected
}

const MAX_EVENTS = 40
const MAX_INVENTORY = 40
const MAX_TEXT_LINES = 30

function isObject(value: unknown): value is Loose {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isGameState(value: unknown): value is Loose {
  return isObject(value) && 'scene' in value && ('nearbyEvents' in value || 'party' in value || 'windows' in value || 'inventory' in value)
}

/** Drop null / false / empty fields so small models spend tokens on facts. */
function present(value: Loose): Loose {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== false && item !== '' && !(Array.isArray(item) && !item.length))
  )
}

function names(list: unknown): string[] {
  return Array.isArray(list) ? list.map((item) => (isObject(item) ? item.name : item)).filter((name): name is string => typeof name === 'string' && !!name) : []
}

/** Keep empty slots so the model can tell unequipped weapon/armor from bag items. */
function equipmentSlots(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.map((item, index) => {
    const slot = isObject(item) && typeof item.slot === 'number' ? item.slot : index
    const name = isObject(item) && typeof item.name === 'string' && item.name ? item.name : 'empty'
    return `${slot}:${name}`
  })
}

function inventory(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const lines = list.filter(isObject).map((item) => `${String(item.name ?? item.id)}${typeof item.count === 'number' && item.count !== 1 ? `×${item.count}` : ''}`)
  return lines.length > MAX_INVENTORY ? [...lines.slice(0, MAX_INVENTORY), `…${lines.length - MAX_INVENTORY} more`] : lines
}

function lines(list: unknown): string[] {
  return Array.isArray(list) ? [...new Set(list.filter((item): item is string => typeof item === 'string' && !!item.trim()))].slice(0, MAX_TEXT_LINES) : []
}

function projectState(state: Loose): Loose {
  // Events whose current page does nothing (lights, used-up pickups, disabled pages) only distract small models.
  const all = Array.isArray(state.nearbyEvents) ? state.nearbyEvents.filter(isObject) : []
  const events = all.filter((event) => event.interactive !== false)
  const party = Array.isArray(state.party) ? state.party.filter(isObject) : []
  const bag = isObject(state.inventory) ? state.inventory : null
  const rendered = isObject(state.renderedText) ? state.renderedText : null
  return present({
    scene: state.scene,
    map: state.map,
    player: state.player,
    message: state.message,
    nearbyEvents: !('nearbyEvents' in state)
      ? undefined
      : events.slice(0, MAX_EVENTS).map((event) => {
          const projected = present({
            id: event.id,
            name: event.name,
            effects: event.effects,
            x: event.x,
            y: event.y,
            distance: event.distance,
            trigger: event.trigger,
            look: event.look,
            animated: event.animated,
            sprite: event.sprite,
            opened: event.opened,
            hint: event.hint,
            kind: event.kind,
            interactionClass: event.interactionClass,
            visualCue: event.visualCue,
            rewardPotential: event.rewardPotential,
            descriptionOnly: event.descriptionOnly,
            transit: event.transit,
            routeStatus: event.routeStatus,
            routeDistance: event.routeDistance,
            interactionPosition: event.interactionPosition,
            eventBoundaryIds: event.eventBoundaryIds,
          })
          return {
            ...projected,
            ...(event.transit !== undefined ? { transit: event.transit } : {}),
            ...(event.routeDistance !== undefined ? { routeDistance: event.routeDistance } : {}),
            ...(event.interactionPosition !== undefined ? { interactionPosition: event.interactionPosition } : {}),
          }
        }),
    inactiveEvents: all.length - events.length || null,
    windows: Array.isArray(state.windows)
      ? state.windows.filter(isObject).map((window) => present({ name: window.name, active: window.active, index: window.index, symbol: window.symbol, options: window.options }))
      : null,
    battle: state.battle,
    commandInputs: state.commandInputs,
    qte: state.qte,
    lastBattleResult: state.lastBattleResult,
    party: party.map((member) =>
      present({
        name: member.name,
        level: member.level,
        hp: member.hp,
        mhp: member.mhp,
        mp: member.mp,
        mmp: member.mmp,
        states: names(member.states),
        equipment: equipmentSlots(member.equipment),
      })
    ),
    gold: state.gold,
    inventory: bag ? present({ items: inventory(bag.items), weapons: inventory(bag.weapons), armors: inventory(bag.armors) }) : null,
    // Menu slot labels often land in recentBitmap while visible stays empty.
    renderedText: rendered ? lines(Array.isArray(rendered.visible) && rendered.visible.length ? rendered.visible : rendered.recentBitmap) : null,
    title: state.title,
  })
}

/**
 * Model-facing view of `game.state`: interaction targets and dialogue first,
 * bulky inventory / DOM text reduced, so prompt clipping never hides them.
 * Non-state values pass through; `{ state }` wrappers (input sequences) are projected in place.
 */
export function modelGameState(value: unknown): unknown {
  if (isGameState(value)) return projectState(value)
  if (isObject(value) && isGameState(value.state)) return { ...value, state: projectState(value.state) }
  if (isObject(value) && typeof value.eventId === 'number' && typeof value.outcome === 'string') {
    const navigation = isObject(value.navigation) ? value.navigation : null
    return present({
      eventId: value.eventId,
      name: value.name,
      outcome: value.outcome,
      messages: value.messages,
      goldChange: value.goldChange,
      inventoryChanges: value.inventoryChanges,
      transferred: value.transferred,
      mapId: value.mapId,
      scene: value.scene,
      position: value.position,
      navigation: navigation
        ? present({
            outcome: navigation.outcome,
            plannedSteps: navigation.plannedSteps,
            replanCount: navigation.replanCount,
            blockedBy: navigation.blockedBy,
            finalPosition: navigation.finalPosition,
          })
        : null,
    })
  }
  return value
}

/** Size is bounded by the per-list caps above, never by cutting the JSON text. */
export function modelGameStateText(value: unknown): string {
  return JSON.stringify(modelGameState(value)) ?? 'null'
}
