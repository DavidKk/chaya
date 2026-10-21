/**
 * WebSocket Relay Server for local game bridge (RGSS / native games <-> Web Console).
 * Listens on port 3928 (or PORT + 1) and routes messages between the browser and game.
 */
import { WebSocket, WebSocketServer } from 'ws'

type SessionSlot = {
  roomId: string
  webSockets: Set<WebSocket>
  gameSockets: Set<WebSocket>
  lastGameSeen: number
}

const STORE_KEY = '__chaya_bridge_ws_server__'

type GlobalStore = {
  server?: WebSocketServer
  port?: number
  slots: Map<string, SessionSlot>
}

function getStore(): GlobalStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: GlobalStore }
  return (g[STORE_KEY] ??= { slots: new Map() })
}

function getOrCreateSlot(roomId: string): SessionSlot {
  const store = getStore()
  let slot = store.slots.get(roomId)
  if (!slot) {
    slot = { roomId, webSockets: new Set(), gameSockets: new Set(), lastGameSeen: 0 }
    store.slots.set(roomId, slot)
  }
  return slot
}

export function hasAnyGameConnected(): boolean {
  const store = getStore()
  for (const slot of store.slots.values()) {
    if (slot.gameSockets.size > 0) return true
  }
  return false
}

export function startBridgeWsServer(port = 3928): number {
  const store = getStore()
  if (store.server) return store.port ?? port

  try {
    const wss = new WebSocketServer({ port })
    store.server = wss
    store.port = port

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const role = url.searchParams.get('role') || 'web' // 'web' or 'game'
      const roomId = url.searchParams.get('roomId') || 'default'

      const slot = getOrCreateSlot(roomId)
      if (role === 'game') {
        slot.gameSockets.add(ws)
        slot.lastGameSeen = Date.now()
      } else {
        slot.webSockets.add(ws)
      }

      ws.on('message', (raw) => {
        const text = raw.toString()
        if (role === 'game') {
          slot.lastGameSeen = Date.now()
          for (const client of slot.webSockets) {
            if (client.readyState === WebSocket.OPEN) client.send(text)
          }
        } else {
          for (const client of slot.gameSockets) {
            if (client.readyState === WebSocket.OPEN) client.send(text)
          }
        }
      })

      ws.on('close', () => {
        if (role === 'game') slot.gameSockets.delete(ws)
        else slot.webSockets.delete(ws)
      })

      ws.on('error', () => {
        ws.close()
      })
    })

    wss.on('error', () => {})

    return port
  } catch {
    return port
  }
}

export function getBridgeWsPort(): number {
  const store = getStore()
  return store.port ?? 3928
}
