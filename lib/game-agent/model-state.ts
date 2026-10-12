type Loose = Record<string, unknown>

const MAX_EVENTS = 40
const MAX_INVENTORY = 40
const MAX_TEXT_LINES = 30

function isObject(value: unknown): value is Loose {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isGameState(value: unknown): value is Loose {
  return isObject(value) && 'scene' in value && Array.isArray(value.nearbyEvents)
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
  const all = (state.nearbyEvents as unknown[]).filter(isObject)
  const events = all.filter((event) => event.interactive !== false)
  const party = Array.isArray(state.party) ? state.party.filter(isObject) : []
  const bag = isObject(state.inventory) ? state.inventory : null
  const rendered = isObject(state.renderedText) ? state.renderedText : null
  return present({
    scene: state.scene,
    map: state.map,
    player: state.player,
    message: state.message,
    nearbyEvents: events.slice(0, MAX_EVENTS).map((event) =>
      present({
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
      })
    ),
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
        equipment: names(member.equipment),
      })
    ),
    gold: state.gold,
    inventory: bag ? present({ items: inventory(bag.items), weapons: inventory(bag.weapons), armors: inventory(bag.armors) }) : null,
    renderedText: rendered ? lines(rendered.visible) : null,
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
  return value
}

/** Size is bounded by the per-list caps above, never by cutting the JSON text. */
export function modelGameStateText(value: unknown): string {
  return JSON.stringify(modelGameState(value)) ?? 'null'
}
