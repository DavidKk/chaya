/** Tab-local navigation metadata, independent of Next or the GameEdit host. */
export type NavigationEntry = { id: string; href: string; parent?: { id: string; href: string } }
export type ScrollSnapshot = { x: number; y: number; height: number; view?: string; anchor?: string; offset?: number; focus?: number; neighbors?: string[]; pending?: boolean }
const STORAGE = 'chaya.navigation.v1'
const LIMIT = 80
let memory: Record<string, ScrollSnapshot> = {}
let loaded = false
export function readScrollSnapshot(key: string): ScrollSnapshot | undefined {
  if (!loaded) {
    loaded = true
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE) || '{}')
      memory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      memory = {}
    }
  }
  const value = memory[key]
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : undefined
}
export function writeScrollSnapshot(key: string, value: ScrollSnapshot) {
  readScrollSnapshot(key)
  delete memory[key]
  memory[key] = value
  for (const old of Object.keys(memory).slice(0, -LIMIT)) delete memory[old]
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(memory))
  } catch {
    /* Memory still works when storage is disabled. */
  }
}
export function localNavigationHref(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.href)
    return url.origin === window.location.origin ? url.pathname + url.search : null
  } catch {
    return null
  }
}
export function newNavigationEntry(href: string, parent?: NavigationEntry): NavigationEntry {
  return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, href, ...(parent ? { parent: { id: parent.id, href: parent.href } } : {}) }
}
