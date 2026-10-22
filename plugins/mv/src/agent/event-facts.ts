/** Facts about a map event's active page that ChayaAgent reports to the model; naming what the event is stays with the model. */

type Loose = Record<string, unknown>

function g(): Loose {
  return globalThis as unknown as Loose
}

function read<T = unknown>(obj: unknown, name: string, ...args: unknown[]): T | undefined {
  try {
    const fn = (obj as Loose | null | undefined)?.[name]
    return typeof fn === 'function' ? ((fn as (...values: unknown[]) => unknown).apply(obj, args) as T) : undefined
  } catch {
    return undefined
  }
}

/** Localization plugins store keys such as `{Map004-22}` in event text and resolve them when the line is shown. */
const TEXT_PLACEHOLDER = /^\{[^{}\s]+\}$/

/** Resolves a localization key the way the game would show it: plugins hook `Game_Message.add`. */
function shownLine(line: string): string | null {
  if (!TEXT_PLACEHOLDER.test(line)) return line
  try {
    const probe = new (g().Game_Message as new () => { add: (text: string) => void; _texts?: unknown[] })()
    probe.add(line)
    const shown = probe._texts?.[0]
    return typeof shown === 'string' && shown.trim() && !TEXT_PLACEHOLDER.test(shown.trim()) ? shown.trim() : null
  } catch {
    return null
  }
}

/** First Show Text line of the event's active page; game text, so callers must treat it as untrusted data. */
export function eventHint(event: Loose): string | null {
  const list = read<Array<{ code?: number; parameters?: unknown[] }>>(event, 'list') ?? []
  const line = list.find((command) => command?.code === 401)?.parameters?.[0]
  const shown = typeof line === 'string' && line.trim() ? shownLine(line.trim()) : null
  return shown ? shown.slice(0, 60) : null
}

/** RPG Maker event commands that tell the model what activating the event does. */
const EVENT_EFFECTS: Record<number, string> = {
  101: 'text',
  102: 'choice',
  117: 'common_event',
  125: 'gold',
  126: 'item',
  127: 'weapon',
  128: 'armor',
  201: 'transfer',
  301: 'battle',
  302: 'shop',
}

/**
 * Facts read from the active page only. Whether the event is an NPC, monster,
 * chest, door or quest giver is left to the model, which also sees name, sprite and hint.
 */
export function eventFacts(event: Loose): { effects: string[]; interactive: boolean } {
  const commands = read<Array<{ code?: number }>>(event, 'list') ?? []
  const codes = new Set(commands.map((command) => command?.code).filter((code): code is number => typeof code === 'number' && code !== 0))
  const effects = [...new Set([...codes].map((code) => EVENT_EFFECTS[code]).filter((effect): effect is string => !!effect))]
  const trigger = event._trigger
  // An empty page (lights, scenery, disabled states) does nothing when touched or confirmed.
  return { effects, interactive: codes.size > 0 && (trigger === 0 || trigger === 1 || trigger === 2) }
}

/** How the engine draws the event; the model uses it to tell people, objects and invisible examine spots apart. */
export function eventLook(event: Loose): { look: 'character' | 'object' | 'tile' | 'none'; animated: boolean } {
  const name = event._characterName
  const images = g().ImageManager as { isObjectCharacter?: (name: string) => boolean } | undefined
  const look = Number(event._tileId) > 0 ? 'tile' : typeof name !== 'string' || !name ? 'none' : images?.isObjectCharacter?.(name) ? 'object' : 'character'
  return { look, animated: look !== 'none' && event._stepAnime === true }
}

/** Detect the opened chest page without relying on one particular event command layout. */
export function chestEventOpened(event: Loose, mapId: number, eventId: number): boolean {
  if (event._erased === true) return true
  const data = read<Loose>(event, 'event')
  const pages = Array.isArray(data?.pages) ? data.pages : []
  const pageIndex = typeof event._pageIndex === 'number' ? event._pageIndex : 0
  if (pageIndex <= 0 || !pages.length) return false
  const first = pages[0] as Loose | undefined
  const current = pages[pageIndex] as Loose | undefined
  const firstImage = first?.image as Loose | undefined
  const currentImage = current?.image as Loose | undefined
  // This game's normal chest open page keeps the same character sheet but turns
  // the event upward (direction 8). Some chests disappear after collection.
  if (currentImage && firstImage) {
    const currentName = typeof currentImage.characterName === 'string' ? currentImage.characterName : ''
    const firstName = typeof firstImage.characterName === 'string' ? firstImage.characterName : ''
    if (!currentName && !!firstName) return true
    if (currentName === firstName && currentImage.direction === 8 && firstImage.direction !== 8) return true
  }
  const switches = g().$gameSelfSwitches as Loose | undefined
  const raw = switches?._data as Loose | undefined
  const switchOn = (letter: string) => read<boolean>(switches, 'value', [mapId, eventId, letter]) === true || raw?.[`${mapId},${eventId},${letter}`] === true
  const condition = current?.conditions as Loose | undefined
  if (condition?.selfSwitchValid === true && typeof condition.selfSwitchCh === 'string' && switchOn(condition.selfSwitchCh)) return true
  return false
}
