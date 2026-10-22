import { encodeGameLinkMessage, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'

type NativeWindow = Window & {
  webkit?: { messageHandlers?: { chaya?: { postMessage: (json: string) => void } } }
  chrome?: { webview?: { postMessage: (json: string) => void } }
  __chaya_on_game_message?: (raw: unknown) => void
}
const listeners = new Set<(message: GameLinkMessage) => void>()

export function postToGame(message: GameLinkMessage): void {
  const host = window as NativeWindow
  const send = host.webkit?.messageHandlers?.chaya?.postMessage.bind(host.webkit.messageHandlers.chaya) ?? host.chrome?.webview?.postMessage.bind(host.chrome.webview)
  if (!send) throw new Error('Chaya RGSS native host is unavailable')
  send(encodeGameLinkMessage(message))
}

export function onGameMessage(handler: (message: GameLinkMessage) => void): () => void {
  listeners.add(handler)
  return () => {
    listeners.delete(handler)
  }
}

export function initHostBridge(): () => void {
  const host = window as NativeWindow
  const previous = host.__chaya_on_game_message
  const receive = (raw: unknown) => {
    const message = parseGameLinkMessage(typeof raw === 'string' ? raw : JSON.stringify(raw))
    if (!message) return
    for (const listener of listeners) listener(message)
  }
  host.__chaya_on_game_message = receive
  return () => {
    if (host.__chaya_on_game_message === receive) host.__chaya_on_game_message = previous
  }
}
