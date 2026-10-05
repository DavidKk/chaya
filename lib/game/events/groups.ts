import type { CommonEventInfo, CommonEventsData, CommonEventTrigger } from './types'

/** Leading decoration authors use for separator entries such as `----戦闘----` or `■ Shop` */
const DECOR_LEAD = /^[\s\-=＝―—_~～*＊#＃◆◇■□●○★☆▼▽▲△※・]+/
const DECOR_TRAIL = /[\s\-=＝―—_~～*＊#＃◆◇■□●○★☆▼▽▲△※・]+$/
const BRACKETED = /^[【[＜<〔「『].*[】\]＞>〕」』]$/

/** An empty, decorated entry is a group heading rather than a real event */
export function isSeparatorEvent(ev: Pick<CommonEventInfo, 'rawName' | 'commandCount'>): boolean {
  if (ev.commandCount > 0) return false
  const name = ev.rawName.trim()
  if (!name) return false
  return DECOR_LEAD.test(name) || BRACKETED.test(name)
}

export function separatorTitle(name: string): string {
  const stripped = name.trim().replace(DECOR_LEAD, '').replace(DECOR_TRAIL, '').trim()
  const inner = /^[【[＜<〔「『](.*)[】\]＞>〕」』]$/.exec(stripped)
  return (inner ? inner[1] : stripped).trim() || name.trim()
}

export type CommonEventGroup = {
  /** Separator id; 0 for events before the first separator */
  id: number
  title: string
  events: CommonEventInfo[]
}

export function groupCommonEvents(events: readonly CommonEventInfo[]): CommonEventGroup[] {
  const groups: CommonEventGroup[] = []
  let current: CommonEventGroup = { id: 0, title: '', events: [] }
  for (const ev of events) {
    if (isSeparatorEvent(ev)) {
      if (current.events.length || current.id) groups.push(current)
      current = { id: ev.id, title: separatorTitle(ev.name || ev.rawName), events: [] }
      continue
    }
    current.events.push(ev)
  }
  if (current.events.length || current.id) groups.push(current)
  return groups
}

export type CommonEventFilter = {
  trigger: 'all' | CommonEventTrigger
  query: string
  showEmpty: boolean
  onlyUncalled: boolean
}

const searchCache = new WeakMap<CommonEventInfo, string>()

/** Name, id, dialogue (source and translation), choices and script bodies */
function searchBlob(ev: CommonEventInfo, texts: Readonly<Record<string, string>>): string {
  const cached = searchCache.get(ev)
  if (cached != null) return cached
  const parts = [String(ev.id), ev.name, ev.rawName]
  for (const cmd of ev.list) {
    const p = cmd.parameters
    if ((cmd.code === 401 || cmd.code === 405 || cmd.code === 355 || cmd.code === 655 || cmd.code === 108 || cmd.code === 408) && typeof p[0] === 'string') {
      parts.push(p[0], texts[p[0]] ?? '')
    } else if (cmd.code === 102 && Array.isArray(p[0])) {
      for (const c of p[0]) if (typeof c === 'string') parts.push(c, texts[c] ?? '')
    } else if ((cmd.code === 356 || cmd.code === 357) && typeof p[0] === 'string') {
      parts.push(p[0])
    }
  }
  const blob = parts.join('\n').toLowerCase()
  searchCache.set(ev, blob)
  return blob
}

export function matchesCommonEvent(ev: CommonEventInfo, data: Pick<CommonEventsData, 'calledBy' | 'texts'>, filter: CommonEventFilter): boolean {
  if (filter.trigger !== 'all' && ev.trigger !== filter.trigger) return false
  if (!filter.showEmpty && ev.commandCount === 0) return false
  if (filter.onlyUncalled && (ev.trigger !== 0 || (data.calledBy[ev.id]?.length ?? 0) > 0)) return false
  const q = filter.query.trim().toLowerCase()
  if (q && !searchBlob(ev, data.texts).includes(q)) return false
  return true
}

/** Groups keep their order; groups with no visible events are dropped */
export function filterCommonEventGroups(data: CommonEventsData, filter: CommonEventFilter): CommonEventGroup[] {
  const out: CommonEventGroup[] = []
  for (const group of groupCommonEvents(data.events)) {
    const events = group.events.filter((ev) => matchesCommonEvent(ev, data, filter))
    if (events.length) out.push({ ...group, events })
  }
  return out
}
