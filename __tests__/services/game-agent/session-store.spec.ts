import { beginTurn, finishTurn, getOrCreateSession, resetGameAgentStore, stopTurn } from '@/services/game-agent/session-store'

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
})
