import { sourceEventKey, type SourceGameEvent } from '@/lib/game-agent/audit'
import { assertGameLogWriterLease, GameLogWriterLeaseError, resetGameLogWriterLeases } from '@/services/game-agent/source-writer-lease.server'

function event(epoch: number, connectionId = 'connection-1'): SourceGameEvent {
  const producer = { id: 'plugin-1', kind: 'game_plugin' as const, epoch, sourceSeq: 1 }
  return {
    schemaVersion: 2,
    eventId: sourceEventKey(producer),
    type: 'game.map_changed',
    at: 1,
    producer,
    execution: { host: 'game_plugin', component: 'observer' },
    classification: { domain: 'game_runtime', type: 'game.map_changed', effect: 'runtime_change' },
    targets: [{ kind: 'runtime', id: 'runtime-1', libraryGameId: 'library-1', runtimeInstanceId: 'runtime-1', pluginInstanceId: 'plugin-1', connectionId }],
    correlation: {},
  }
}

describe('game log writer lease', () => {
  beforeEach(() => resetGameLogWriterLeases())

  it('accepts retries, lets a newer epoch take over, and rejects the old connection', () => {
    assertGameLogWriterLease(event(1))
    assertGameLogWriterLease(event(1))
    assertGameLogWriterLease(event(2, 'connection-2'))
    expect(() => assertGameLogWriterLease(event(1))).toThrow(GameLogWriterLeaseError)
  })

  it('isolates leases by runtime instance', () => {
    assertGameLogWriterLease(event(1))
    const second = { ...event(1), targets: [{ ...event(1).targets[0], id: 'runtime-2', runtimeInstanceId: 'runtime-2' }] } as SourceGameEvent
    expect(() => assertGameLogWriterLease(second)).not.toThrow()
  })
})
