import { randomUUID } from 'node:crypto'

import type { GameAgentSession, GameAgentTurn } from './types'

type Store = { sessions: Map<string, GameAgentSession>; byGame: Map<string, string>; turns: Map<string, GameAgentTurn> }
const STORE_KEY = '__chaya_game_agent_store_v1__'

function store(): Store {
  const root = globalThis as typeof globalThis & { [STORE_KEY]?: Store }
  return (root[STORE_KEY] ??= { sessions: new Map(), byGame: new Map(), turns: new Map() })
}

export function getOrCreateSession(gameId: string, profileId: string, model: string, requestedId?: string, forceNew = false): GameAgentSession {
  const state = store()
  const currentId = state.byGame.get(gameId)
  const current = currentId ? state.sessions.get(currentId) : undefined
  if (current?.activeTurnId) {
    const active = state.turns.get(current.activeTurnId)
    if (active?.state === 'running' || active?.state === 'waiting_user') return current
  }
  const knownId = forceNew ? undefined : requestedId || state.byGame.get(gameId)
  const known = knownId ? state.sessions.get(knownId) : undefined
  if (known && known.gameId === gameId) {
    known.model = model
    known.profileId = profileId
    known.updatedAt = Date.now()
    return known
  }
  const session: GameAgentSession = { id: randomUUID(), gameId, profileId, model, messages: [], activeTurnId: null, updatedAt: Date.now() }
  state.sessions.set(session.id, session)
  state.byGame.set(gameId, session.id)
  return session
}

export function getSessionForGame(gameId: string): GameAgentSession | null {
  const id = store().byGame.get(gameId)
  return (id && store().sessions.get(id)) || null
}

export function beginTurn(session: GameAgentSession): GameAgentTurn {
  if ([...store().turns.values()].some((turn) => turn.gameId === session.gameId && (turn.state === 'running' || turn.state === 'waiting_user')))
    throw new Error('AGENT_TURN_RUNNING')
  if (session.activeTurnId) {
    const active = store().turns.get(session.activeTurnId)
    if (active?.state === 'running' || active?.state === 'waiting_user') throw new Error('AGENT_TURN_RUNNING')
  }
  const turn: GameAgentTurn = {
    id: randomUUID(),
    sessionId: session.id,
    gameId: session.gameId,
    abort: new AbortController(),
    state: 'running',
    startedAt: Date.now(),
    lastSeq: 0,
    events: [],
    listeners: new Set(),
  }
  store().turns.set(turn.id, turn)
  session.activeTurnId = turn.id
  session.lastTurnId = turn.id
  session.updatedAt = Date.now()
  return turn
}

export function finishTurn(turn: GameAgentTurn, state: GameAgentTurn['state']) {
  turn.state = state
  const session = store().sessions.get(turn.sessionId)
  if (session?.activeTurnId === turn.id) session.activeTurnId = null
  if (session) session.updatedAt = Date.now()
}

export function stopTurn(turnId: string, gameId?: string): GameAgentTurn | null {
  const turn = store().turns.get(turnId)
  if (!turn || (gameId && turn.gameId !== gameId)) return null
  if (turn.state === 'running' || turn.state === 'waiting_user') {
    turn.state = 'stopped'
    turn.abort.abort(new DOMException('Stopped', 'AbortError'))
    turn.resume?.()
    const session = store().sessions.get(turn.sessionId)
    if (session?.activeTurnId === turn.id) session.activeTurnId = null
  }
  return turn
}

export function emitTurnEvent(turn: GameAgentTurn, event: import('./types').GameAgentEvent) {
  const item = { ...event, seq: ++turn.lastSeq }
  turn.events.push(item)
  if (turn.events.length > 200) turn.events.shift()
  if (event.type === 'phase') turn.phase = event.phase
  if (event.type === 'goal.updated') turn.goal = event.summary
  if (event.type === 'approval.required') turn.question = event.question
  for (const listener of turn.listeners) listener(item)
}

export function subscribeTurn(turn: GameAgentTurn, listener: (event: import('./types').SequencedGameAgentEvent) => void) {
  turn.listeners.add(listener)
  return () => turn.listeners.delete(listener)
}

export function getTurn(turnId: string) {
  return store().turns.get(turnId) || null
}

export function resetGameAgentStore() {
  for (const turn of store().turns.values()) turn.abort.abort()
  store().sessions.clear()
  store().byGame.clear()
  store().turns.clear()
}
