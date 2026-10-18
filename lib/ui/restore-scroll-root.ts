import { type ScrollSnapshot, writeScrollSnapshot } from './navigation-snapshot'

const ROW = '[data-navigation-id]'
function rowControls(row: HTMLElement) {
  const selector = 'a,button,input,select,textarea,[tabindex]'
  return [...(row.matches(selector) ? [row] : []), ...row.querySelectorAll<HTMLElement>(selector)]
}
export function findNavigationRow(root: HTMLElement, id?: string): HTMLElement | undefined {
  return id ? Array.from(root.querySelectorAll<HTMLElement>(ROW)).find((row) => row.dataset.navigationId === id) : undefined
}
export function snapshotScrollRoot(root: HTMLElement, previous?: ScrollSnapshot, anchor?: HTMLElement): ScrollSnapshot {
  const row = anchor || findNavigationRow(root, previous?.anchor)
  const controls = row ? rowControls(row) : []
  const rows = Array.from(root.querySelectorAll<HTMLElement>(ROW))
  const at = row ? rows.indexOf(row) : -1
  const tree = root.getRootNode()
  const focused = tree instanceof ShadowRoot ? tree.activeElement : document.activeElement
  return {
    x: root.scrollLeft,
    y: root.scrollTop,
    height: root.scrollHeight,
    ...(row
      ? {
          anchor: row.dataset.navigationId,
          offset: row.getBoundingClientRect().top - root.getBoundingClientRect().top,
          focus: Math.max(0, controls.indexOf(focused as HTMLElement)),
          neighbors: [rows[at + 1]?.dataset.navigationId, rows[at - 1]?.dataset.navigationId].filter((id): id is string => !!id),
        }
      : {}),
  }
}
export function restoreScrollRoot(root: HTMLElement, saved: ScrollSnapshot, key: string, getAnchorTop?: (id: string) => number | undefined): () => void {
  let stopped = false,
    frame = 0,
    timer = 0,
    settleTimer = 0
  let animation: Animation | undefined
  const start = performance.now()
  const stop = () => {
    stopped = true
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    clearTimeout(settleTimer)
    observer.disconnect()
    resize.disconnect()
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) root.removeEventListener(type, interrupt, true)
  }
  const cancel = () => {
    stop()
    animation?.cancel()
  }
  const interrupt = () => {
    cancel()
    writeScrollSnapshot(key, { ...saved, x: root.scrollLeft, y: root.scrollTop, pending: false })
  }
  const finish = (row?: HTMLElement, flash = false) => {
    stop()
    if (saved.pending && row) {
      const controls = rowControls(row)
      controls[saved.focus || 0]?.focus({ preventScroll: true })
      if (flash && row.animate) {
        const color = 'color-mix(in oklab, var(--accent) 22%, transparent)'
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        row.dataset.navigationHighlight = 'active'
        animation = row.animate(
          reduced
            ? [{ backgroundColor: color }, { backgroundColor: color }]
            : [
                { backgroundColor: 'transparent', offset: 0 },
                { backgroundColor: color, offset: 0.2 },
                { backgroundColor: 'transparent', offset: 0.5 },
                { backgroundColor: color, offset: 0.7 },
                { backgroundColor: 'transparent', offset: 1 },
              ],
          { duration: 1200, iterations: 1, easing: 'ease-in-out' }
        )
        const clear = () => {
          delete row.dataset.navigationHighlight
        }
        animation.onfinish = clear
        animation.oncancel = clear
      }
    }
    writeScrollSnapshot(key, { ...saved, x: root.scrollLeft, y: root.scrollTop, pending: false })
  }
  const attempt = () => {
    frame = 0
    if (stopped || !root.isConnected) return
    if (!root.clientHeight || root.closest('[aria-busy="true"]') || root.querySelector('[aria-busy="true"]')) return
    const row = findNavigationRow(root, saved.anchor)
    const neighbor = !row ? saved.neighbors?.map((id) => findNavigationRow(root, id)).find(Boolean) : undefined
    const anchor = row || neighbor
    const elapsed = performance.now() - start
    if (!row && getAnchorTop) {
      const top = saved.anchor ? getAnchorTop(saved.anchor) : undefined
      root.scrollTop = top !== undefined ? top - (saved.offset || 0) : saved.y
      root.scrollLeft = saved.x
      // Materialize the target virtual range before looking for its DOM row.
      if (elapsed < 900 || (root.scrollHeight < saved.y + root.clientHeight && elapsed < 7500)) return
    }
    if (saved.anchor && !row && elapsed < 900) return
    if (!anchor && root.scrollHeight < saved.y + root.clientHeight && elapsed < 900) return
    root.scrollLeft = saved.x
    root.scrollTop = anchor && saved.offset !== undefined ? root.scrollTop + anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - saved.offset : saved.y
    finish(anchor, !!row)
  }
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(attempt)
  }
  const observer = new MutationObserver(schedule)
  const resize = new ResizeObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
  resize.observe(root)
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) root.addEventListener(type, interrupt, { capture: true, passive: true })
  settleTimer = window.setTimeout(attempt, 950)
  timer = window.setTimeout(() => {
    attempt()
    if (!stopped) stop()
  }, 8000)
  schedule()
  return cancel
}
