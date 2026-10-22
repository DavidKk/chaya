/**
 * Structured menu/window lists for agent observation.
 * Command windows expose `_list`/`options`; equip slots and item lists do not —
 * those need maxItems/slotName/_data so the model can see "武器 / 盾牌 / …".
 */

type Loose = Record<string, unknown>
type AnyFn = (...args: unknown[]) => unknown

export type WindowOption = {
  label: string | null
  symbol: string | null
  enabled: boolean
  index?: number
  itemId?: number | null
  item?: { id: number | null; name: string | null } | null
}

export type SceneWindow = {
  name: string
  active: boolean
  index: unknown
  maxCols: unknown
  symbol: unknown
  item: unknown
  options: WindowOption[] | null
}

function read<T = unknown>(obj: unknown, name: string, ...args: unknown[]): T | undefined {
  try {
    const fn = (obj as Loose | null | undefined)?.[name]
    return typeof fn === 'function' ? ((fn as AnyFn).apply(obj, args) as T) : undefined
  } catch {
    return undefined
  }
}

function itemRef(item: unknown): { id: number | null; name: string | null } | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Loose
  const id = typeof row.id === 'number' ? row.id : null
  const name = typeof row.name === 'string' ? row.name : null
  if (id == null && name == null) return null
  return { id, name }
}

function commandOptions(win: Loose): WindowOption[] | null {
  const menu = Array.isArray(win.options) ? win.options : Array.isArray(win._list) ? win._list : null
  if (!menu?.length) return null
  return menu.slice(0, 30).map((entry: Loose, index: number) => ({
    label: typeof entry.label === 'string' ? entry.label : typeof entry.name === 'string' ? entry.name : null,
    symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
    enabled: entry.enabled !== false,
    index,
  }))
}

/** Window_EquipSlot: slot names + currently equipped item per index. */
function equipSlotOptions(win: Loose): WindowOption[] | null {
  if (typeof win.slotName !== 'function') return null
  const max = read<number>(win, 'maxItems')
  if (typeof max !== 'number' || max <= 0) return null
  const actor = win._actor as Loose | undefined
  const equips = read<unknown[]>(actor, 'equips') ?? []
  const options: WindowOption[] = []
  for (let index = 0; index < Math.min(max, 20); index++) {
    const slot = read<string>(win, 'slotName', index)
    const equipped = itemRef(equips[index])
    const slotLabel = typeof slot === 'string' && slot.trim() ? slot.trim() : `slot:${index}`
    options.push({
      label: equipped?.name ? `${slotLabel}: ${equipped.name}` : `${slotLabel}: <空>`,
      symbol: `slot:${index}`,
      enabled: true,
      index,
      itemId: equipped?.id ?? null,
      item: equipped,
    })
  }
  return options
}

/** Window_ItemList / Window_EquipItem: selectable bag rows in `_data`. */
function itemListOptions(win: Loose): WindowOption[] | null {
  const data = Array.isArray(win._data) ? (win._data as unknown[]) : null
  if (!data?.length) return null
  return data.slice(0, 40).map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return { label: '<空>', symbol: null, enabled: true, index, itemId: null, item: null }
    }
    const item = itemRef(entry)
    return {
      label: item?.name ?? null,
      symbol: null,
      enabled: true,
      index,
      itemId: item?.id ?? null,
      item,
    }
  })
}

function windowOptions(win: Loose): WindowOption[] | null {
  return commandOptions(win) ?? equipSlotOptions(win) ?? itemListOptions(win)
}

export function readSceneWindows(scene: Loose | undefined, toJsonSafe: (value: unknown, depth?: number) => unknown): SceneWindow[] {
  if (!scene) return []
  return Object.entries(scene)
    .filter(([name, value]) => name.endsWith('Window') && value && typeof value === 'object')
    .map(([name, value]): SceneWindow | null => {
      const win = value as Loose
      const visible = win.visible !== false && Number(win.openness ?? 255) > 0
      if (!visible) return null
      return {
        name: name.replace(/^_/, ''),
        active: Boolean(win.active),
        index: read(win, 'index') ?? win._index ?? null,
        maxCols: read(win, 'maxCols') ?? 1,
        symbol: read(win, 'currentSymbol') ?? null,
        item: toJsonSafe(read(win, 'item'), 2),
        options: windowOptions(win),
      } satisfies SceneWindow
    })
    .filter((window): window is SceneWindow => !!window)
    .slice(0, 30)
}
