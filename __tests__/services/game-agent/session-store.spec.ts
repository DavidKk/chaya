import { beginTurn, emitTurnEvent, finishTurn, getOrCreateSession, resetGameAgentStore, stopTurn, subscribeTurn } from '@/services/game-agent/session-store'

describe('game agent session store', () => {
  afterEach(resetGameAgentStore)

  it('isolates sessions by game and allows one active turn per game', () => {
    const a = getOrCreateSession('game-a', 'profile-a', 'model-a')
    const b = getOrCreateSession('game-b', 'profile-b', 'model-b')
    expect(a.id).not.toBe(b.id)
    const turn = beginTurn(a)
    expect(() => beginTurn(a)).toThrow('AGENT_TURN_RUNNING')
    expect(() => beginTurn(b)).not.toThrow()
    finishTurn(turn, 'completed')
    expect(() => beginTurn(a)).not.toThrow()
  })

  it('creates a fresh conversation when requested', () => {
    const first = getOrCreateSession('game-a', 'profile', 'model')
    const reused = getOrCreateSession('game-a', 'profile', 'model')
    const fresh = getOrCreateSession('game-a', 'profile', 'model', undefined, true)
    expect(reused.id).toBe(first.id)
    expect(fresh.id).not.toBe(first.id)
  })

  it('stops idempotently and refuses a mismatched game id', () => {
    const session = getOrCreateSession('game-a', 'profile', 'model')
    const turn = beginTurn(session)
    expect(stopTurn(turn.id, 'game-b')).toBeNull()
    expect(stopTurn(turn.id, 'game-a')?.state).toBe('stopped')
    expect(stopTurn(turn.id, 'game-a')?.state).toBe('stopped')
    expect(turn.abort.signal.aborted).toBe(true)
  })

  it('keeps a waiting task exclusive even when a new session is requested', () => {
    const session = getOrCreateSession('game-a', 'profile', 'model')
    const turn = beginTurn(session)
    turn.state = 'waiting_user'
    expect(getOrCreateSession('game-a', 'profile', 'model', undefined, true)).toBe(session)
    expect(() => beginTurn(session)).toThrow('AGENT_TURN_RUNNING')
    const resume = jest.fn()
    turn.resume = resume
    stopTurn(turn.id, 'game-a')
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('sequences events and replays the retained window to subscribers', () => {
    const turn = beginTurn(getOrCreateSession('game-a', 'profile', 'model'))
    const listener = jest.fn()
    const unsubscribe = subscribeTurn(turn, listener)
    emitTurnEvent(turn, { type: 'goal.updated', summary: '当前战斗' })
    emitTurnEvent(turn, { type: 'phase', phase: 'thinking', step: 1, maxSteps: 20 })
    unsubscribe()
    emitTurnEvent(turn, { type: 'turn.stopped' })
    expect(listener.mock.calls.map(([event]) => event.seq)).toEqual([1, 2])
    expect(turn.events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(turn.goal).toBe('当前战斗')
  })
})
