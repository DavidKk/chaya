const GAME_POINTER_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
] as const

// Stored on the host so a hot-reloaded module replaces the old listener instead of stacking another
const STOP_KEY = '__chayaPointerIsolation_v1__'
type IsolatedHost = HTMLElement & { [STOP_KEY]?: (event: Event) => void }

/** Keep pointer input inside an overlay host from bubbling to RPG Maker's document-level TouchInput. */
export function isolateGamePointerInput(host: HTMLElement): () => void {
  const target = host as IsolatedHost
  const previous = target[STOP_KEY]
  if (previous) for (const type of GAME_POINTER_EVENTS) host.removeEventListener(type, previous)
  const stop = (event: Event) => event.stopPropagation()
  for (const type of GAME_POINTER_EVENTS) host.addEventListener(type, stop)
  target[STOP_KEY] = stop
  return () => {
    if (target[STOP_KEY] !== stop) return
    for (const type of GAME_POINTER_EVENTS) host.removeEventListener(type, stop)
    delete target[STOP_KEY]
  }
}
