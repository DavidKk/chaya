import { localNavigationHref, type NavigationEntry, newNavigationEntry, readScrollSnapshot, type ScrollSnapshot, writeScrollSnapshot } from './navigation-snapshot'
import { restoreScrollRoot, snapshotScrollRoot } from './restore-scroll-root'

const FIELD = '__chayaNavigation'
const TRIGGER = 'a[href],[data-navigation-trigger]'
function clickedRow(event: Event) {
  const target = event.target instanceof Element ? event.target : null
  return target?.closest(TRIGGER) ? target.closest<HTMLElement>('[data-navigation-id]') : null
}
type Root = {
  element: HTMLElement
  name: string
  entry: NavigationEntry
  saved?: ScrollSnapshot
  clicked?: boolean
  cancel?: () => void
  getAnchorTop?: (id: string) => number | undefined
}
const roots = new Set<Root>()
let active: NavigationEntry | undefined
let installed = false
const subscribers = new Set<() => void>()
function publish() {
  // HistoryUpdater may write from an insertion effect; notify React after its commit.
  queueMicrotask(() => {
    for (const listener of subscribers) listener()
  })
}
export function subscribeNavigationEntry(listener: () => void) {
  install()
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}
export function navigationEntryId() {
  return active?.id || ''
}
function currentHref() {
  return location.pathname + location.search
}
function key(root: Root) {
  return `${root.entry.id}:${root.entry.href}:${root.name}`
}
function persist(root: Root, pending = false) {
  if (root.element.isConnected && root.element.clientHeight && !root.element.closest('[aria-busy="true"]') && !root.element.querySelector('[aria-busy="true"]')) {
    root.saved = { ...snapshotScrollRoot(root.element, root.saved), pending }
    writeScrollSnapshot(key(root), root.saved)
  } else if (pending && root.saved) writeScrollSnapshot(key(root), { ...root.saved, pending: true })
}
function restore(root: Root) {
  root.cancel?.()
  const saved = readScrollSnapshot(key(root))
  root.saved = saved
  root.clicked = false
  if (saved) root.cancel = restoreScrollRoot(root.element, saved, key(root), root.getAnchorTop)
}
export function commitNavigationRestoration() {
  if (!active) return
  for (const root of roots) {
    if (root.entry.id !== active.id || root.entry.href !== active.href) {
      root.entry = active
      restore(root)
    }
  }
}
function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const state = history.state?.[FIELD] as NavigationEntry | undefined
  active = state?.href === currentHref() ? state : newNavigationEntry(currentHref())
  history.replaceState({ ...history.state, [FIELD]: active }, '')
  history.scrollRestoration = 'manual'
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history)
    history[method] = (data, title, url) => {
      const href = url == null ? currentHref() : localNavigationHref(String(url))
      let entry = active!
      if (href && (method === 'pushState' || href !== active?.href)) {
        for (const root of roots) {
          persist(root, true)
          root.cancel?.()
        }
        entry = method === 'pushState' ? newNavigationEntry(href, active) : { ...active!, href }
      }
      const result = original({ ...data, [FIELD]: entry }, title, url)
      active = entry
      publish()
      return result
    }
  }
  window.addEventListener('popstate', (event) => {
    for (const root of roots) {
      persist(root, true)
      root.cancel?.()
    }
    active = event.state?.[FIELD] || newNavigationEntry(currentHref())
    publish()
  })
  document.addEventListener(
    'click',
    (event) => {
      const row = clickedRow(event)
      if (!row) {
        for (const root of roots) {
          // The return button belongs to the child; preserve a hidden GameEdit source.
          if (!root.element.clientHeight || !root.element.clientWidth) continue
          root.clicked = false
          root.saved = snapshotScrollRoot(root.element)
          writeScrollSnapshot(key(root), root.saved)
        }
        return
      }
      for (const root of roots)
        if (root.element.contains(row)) {
          root.clicked = true
          root.saved = snapshotScrollRoot(root.element, undefined, row)
          writeScrollSnapshot(key(root), root.saved)
        }
    },
    true
  )
  window.addEventListener('pagehide', () => {
    for (const root of roots) persist(root)
  })
}
export function initializeNavigationRestoration() {
  install()
}
/** Every ScrollArea uses this; explicit keys isolate local filters and GameEdit views. */
export function registerScrollRestoration(element: HTMLElement, name: string, getAnchorTop?: (id: string) => number | undefined): () => void {
  install()
  const root: Root = { element, name, getAnchorTop, entry: active! }
  roots.add(root)
  restore(root)
  const click = (event: Event) => {
    const row = clickedRow(event)
    if (row && element.contains(row)) {
      root.clicked = true
      root.saved = snapshotScrollRoot(element, undefined, row)
      writeScrollSnapshot(key(root), root.saved)
    }
  }
  element.addEventListener('click', click, true)
  const save = () => {
    if (root.entry.id === active?.id && root.entry.href === active.href) persist(root)
  }
  element.addEventListener('scroll', save, { passive: true })
  let visible = element.clientHeight > 0
  const observer = new ResizeObserver(() => {
    const next = element.clientHeight > 0 && element.clientWidth > 0
    if (!visible && next) restore(root)
    if (visible && !next && root.saved) writeScrollSnapshot(key(root), { ...root.saved, pending: !!root.clicked })
    visible = next
  })
  observer.observe(element)
  return () => {
    if (root.saved) writeScrollSnapshot(key(root), { ...root.saved, pending: readScrollSnapshot(key(root))?.pending || !!root.clicked })
    root.cancel?.()
    roots.delete(root)
    observer.disconnect()
    element.removeEventListener('scroll', save)
    element.removeEventListener('click', click, true)
  }
}
export function returnToNavigationSource(router: { back: () => void; push: (href: string) => void }, fallback: string) {
  install()
  if (active?.parent && history.length > 1) router.back()
  else router.push(localNavigationHref(fallback) || '/')
}

/** View state is tied to the actual browser history entry, including after reload. */
export function navigationViewKey(name: string) {
  install()
  return `view:${active!.id}:${name}`
}
