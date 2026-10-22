import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

type Send = (message: GameLinkMessage) => void
type Handlers = { onMessage: (message: GameLinkMessage, send: Send) => void; onStop: () => void }
type Bridge = { handlers: Handlers | null; subscribed: boolean; send: Send | null }

/** ChayaLog and ChayaEdit are separate IIFEs: module locals cannot cross this boundary. */
function bridge(): Bridge {
  const host = globalThis as typeof globalThis & { __chayaEditLinkBridge?: Bridge }
  return (host.__chayaEditLinkBridge ??= { handlers: null, subscribed: false, send: null })
}

export function registerGameLinkEditHandlers(handlers: Handlers): () => void {
  const state = bridge()
  state.handlers?.onStop()
  state.handlers = handlers
  if (state.subscribed && state.send) handlers.onMessage({ type: 'edit.subscribe' }, state.send)
  return () => {
    if (state.handlers !== handlers) return
    handlers.onStop()
    state.handlers = null
  }
}

export function dispatchGameLinkEditMessage(message: GameLinkMessage, send: Send): void {
  const state = bridge()
  if (message.type === 'edit.subscribe') {
    state.subscribed = true
    state.send = send
  }
  if (message.type === 'edit.unsubscribe') {
    state.subscribed = false
    state.send = null
  }
  state.handlers?.onMessage(message, send)
}

export function stopGameLinkEditBridge(): void {
  const state = bridge()
  state.subscribed = false
  state.send = null
  state.handlers?.onStop()
}
