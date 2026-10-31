import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { experienceBatch, hpResult } from '@/__tests__/lib/game-agent/companion/experience-fixtures'
import type { BattleRecordEvent, MemoryManagementRequest } from '@/lib/game-agent/companion/core/recording-types'
import { createGameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { openCompanionMemoryDb } from '@/services/game-agent/companion-memory-db'
import { createCompanionSqliteStore } from '@/services/storage/companion-store'

const scope = { libraryGameId: 'game-a', dataRevision: 'r1', playthroughId: 'p1', segmentId: 's1', runtimeInstanceId: 'runtime1' }
const start = (encounterId = 'enc-1'): BattleRecordEvent => ({ kind: 'encounter_started', eventId: 'start', scope, encounterId, at: 10, coverage: 'partial' })
const finish = (outcome: 'unknown' | 'win' | 'lose' = 'win'): BattleRecordEvent => ({
  kind: 'encounter_finished',
  eventId: `finish:${outcome}`,
  scope,
  encounterId: 'enc-1',
  at: 20,
  outcome,
  turns: 3,
})
const batch = (batchId: string, events: BattleRecordEvent[], versions = { memoryEpoch: 1, recordingRevision: 1 }): MemoryWriteBatch => ({
  schemaVersion: 1,
  batchId,
  ...versions,
  at: 10,
  battleRecording: { schemaVersion: 1, events },
})
const management = (
  requestId: string,
  action: { action: 'clear'; preferences?: boolean } | { action: 'set_recording'; enabled: boolean },
  memoryEpoch = 1,
  recordingRevision = 1
): MemoryManagementRequest => ({
  requestId,
  expectedMemoryEpoch: memoryEpoch,
  expectedRecordingRevision: recordingRevision,
  ...action,
})

describe('durable companion recording', () => {
  let root: string
  let connection: ReturnType<typeof openCompanionMemoryDb>
  let store: ReturnType<typeof createCompanionSqliteStore>
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-recording-'))
    connection = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
    store = createCompanionSqliteStore(connection.db)
  })
  afterEach(() => {
    connection.db.$client.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reopens canonical evidence as a retrievable experience without persisting duplicate legacy rows', async () => {
    const action: BattleRecordEvent = {
      ...start(),
      kind: 'action_result',
      eventId: 'r1',
      result: {
        resultId: 'r1',
        actionId: 'a1',
        observedAt: 12,
        targetKind: 'enemy',
        targetId: 10,
        evidence: {
          actionId: 'a1',
          resultId: 'r1',
          source: { kind: 'actor', id: 1 },
          target: { kind: 'enemy', id: 10, instance: 'enemy:0' },
          ability: { kind: 'skill', id: 3 },
          hpBefore: null,
          hpAfter: null,
          reportedHpDamage: 5,
          attribution: 'observed_action',
        },
      },
    }
    store.commit('game-a', batch('experience', [start(), action, finish()]))
    connection.db.$client.close()
    connection = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
    store = createCompanionSqliteStore(connection.db)
    const memory = createGameplayMemoryStore({
      backend: {
        ready: async () => {},
        flush: async () => {},
        loadSnapshot: async () => store.load('game-a'),
        commitBatch: async (value) => {
          store.commit('game-a', value)
        },
        clearQueueBarrier: async () => {},
      },
    })
    await memory.ready()
    const query = memory.queryDetailed(scope, { enemyIds: [10], skillIds: [3] })
    expect(query.episodes).toEqual([
      expect.objectContaining({ persistence: 'committed', outcome: 'win', completeness: 'partial', evidence: [expect.objectContaining({ hpBefore: null, hpAfter: null })] }),
    ])
    const episodeId = query.episodes[0].episodeId
    expect(memory.acceptCommittedRecording(batch('retry', [action, finish()]))).toBe(true)
    expect(memory.queryDetailed(scope).episodes).toEqual([expect.objectContaining({ episodeId })])
    expect(memory.queryDetailed({ ...scope, playthroughId: 'other' }).episodes).toEqual([])
    expect(memory.queryExperiences(scope).experiences).toEqual([])
    expect(store.load('game-a').episodes).toEqual([])
    expect(store.load('game-a').battleRecording!.statistics[0]).toMatchObject({ encounters: 1, win: 1 })
    await memory.close()
  })

  it('rebuilds conditional HP experience from SQLite evidence and clears it under the same durable barrier', async () => {
    const events = [0, 1, 2].map((i) => hpResult(i, {}, { scope }))
    const recorded = experienceBatch(events)
    store.commit('game-a', recorded)
    connection.db.$client.close()
    connection = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
    store = createCompanionSqliteStore(connection.db)
    const memory = createGameplayMemoryStore({
      backend: {
        ready: async () => {},
        flush: async () => {},
        loadSnapshot: async () => store.load('game-a'),
        commitBatch: async (value) => {
          store.commit('game-a', value)
        },
        clearQueueBarrier: async () => {},
        manage: async (request) => {
          store.manage('game-a', request)
          return store.load('game-a')
        },
      },
    })
    try {
      await memory.ready()
      const before = memory.queryExperiences(scope)
      expect(before.experiences[0]).toMatchObject({ status: 'conditionally_supported', sampleActions: 3, sampleEncounters: 2, hpLoss: { min: 10, max: 10 } })
      store.commit('game-a', { ...recorded, batchId: 'retry' })
      expect(memory.acceptCommittedRecording(recorded)).toBe(true)
      expect(memory.queryExperiences(scope)).toEqual(before)
      await memory.setRecording(false)
      expect(memory.queryExperiences(scope)).toEqual(before)
      expect(() => store.commit('game-a', { ...experienceBatch([hpResult(3, {}, { scope })], 1, 2), batchId: 'disabled-write' })).toThrow('disabled')
      await memory.clearMemory()
      expect(memory.queryExperiences(scope)).toMatchObject({ memoryEpoch: 2, experiences: [] })
      expect(memory.acceptCommittedRecording(recorded)).toBe(false)
      expect(store.load('game-a').battleRecording!.recentEvents).toEqual([])
    } finally {
      await memory.close()
    }
  })

  it('reads management state across connections without loading history and preserves it after reopen', () => {
    const initial = { memoryEpoch: 1, recordingRevision: 1, recordingEnabled: true }
    expect(store.state('game-a')).toEqual(initial)
    const second = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
    try {
      const other = createCompanionSqliteStore(second.db)
      store.commit('game-a', batch('a', [start()]))
      expect(other.state('game-a')).toEqual(initial)
      const disabled = store.manage('game-a', management('disable', { action: 'set_recording', enabled: false }))
      expect(other.state('game-a')).toEqual(disabled)
      const cleared = other.manage('game-a', management('clear', { action: 'clear' }, disabled.memoryEpoch, disabled.recordingRevision))
      expect(store.state('game-a')).toEqual(cleared)
      expect(store.state('game-b')).toEqual(initial)
      expect(() => store.commit('game-a', batch('stale', [finish()]))).toThrow('version changed')
      connection.db.$client.close()
      connection = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
      store = createCompanionSqliteStore(connection.db)
      expect(store.state('game-a')).toEqual(cleared)
    } finally {
      second.db.$client.close()
    }
  })

  it('deduplicates batch and source retries, upgrades unknown once, and accepts outcome before start', () => {
    const original = batch('a', [finish('unknown')])
    store.commit('game-a', original)
    expect(store.commit('game-a', original)).toMatchObject({ duplicated: true })
    store.commit('game-a', batch('b', [finish('unknown'), finish()]))
    store.commit('game-a', batch('c', [start(), finish()]))
    const snapshot = store.load('game-a').battleRecording!
    expect(snapshot).toMatchObject({ coverage: 'observed_only', projectionVersion: 1, detailsTrimmed: false })
    expect(snapshot.statistics).toEqual([{ libraryGameId: 'game-a', dataRevision: 'r1', playthroughId: 'p1', encounters: 1, win: 1, lose: 0, escape: 0, abort: 0, unknown: 0 }])
    expect(snapshot.recentEvents).toHaveLength(3)
  })

  it('rolls back episodes, source identities and totals together on source or outcome conflict', () => {
    store.commit('game-a', batch('a', [start(), finish()]))
    const before = store.load('game-a')
    const conflicting = batch('b', [start('enc-2'), { ...start(), at: 99 }])
    conflicting.episodes = [
      {
        episodeId: 'ep-1',
        scope,
        memoryEpoch: 1,
        at: 10,
        kind: 'battle_result',
        persistence: 'committed',
        completeness: 'partial',
        summary: 'Observed',
        evidence: [],
      },
    ]
    expect(() => store.commit('game-a', conflicting)).toThrow('conflict')
    expect(store.load('game-a')).toEqual(before)
    expect(() => store.commit('game-a', batch('c', [start('enc-2'), finish('lose')]))).toThrow('Conflicting encounter outcome')
    expect(store.load('game-a')).toEqual(before)
    // A rolled-back batch/source identity remains available to a corrected submission.
    store.commit('game-a', batch('b', [start('enc-2')]))
    expect(store.load('game-a').battleRecording!.statistics[0].encounters).toBe(2)
  })

  it('preserves multiple target results from the same action and command', () => {
    const results: BattleRecordEvent[] = [1, 2].map((targetId) => ({
      kind: 'action_result',
      eventId: `result-${targetId}`,
      scope,
      encounterId: 'enc-1',
      at: 20,
      result: {
        resultId: `result-${targetId}`,
        actionId: 'same-action',
        commandId: 'same-command',
        encounterId: 'enc-1',
        observedAt: 20,
        targetKind: 'enemy',
        targetId,
        hpDamage: 5,
      },
    }))
    store.commit('game-a', batch('a', results))
    store.commit('game-a', batch('b', results))
    expect(store.load('game-a').battleRecording!.recentEvents).toEqual(results)
    expect(store.load('game-a').battleRecording!.statistics[0].encounters).toBe(1)
  })

  it('merges two connections without overwriting and isolates runtime, segment, revision and playthrough', () => {
    const second = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
    try {
      const other = createCompanionSqliteStore(second.db)
      store.commit('game-a', batch('a', [finish()]))
      const scopes = [
        { ...scope, runtimeInstanceId: 'runtime2' },
        { ...scope, segmentId: 's2' },
        { ...scope, playthroughId: 'p2' },
        { ...scope, dataRevision: 'r2' },
      ]
      for (const [index, next] of scopes.entries()) other.commit('game-a', batch(`other-${index}`, [{ ...finish(), scope: next }]))
      expect(store.load('game-a').battleRecording!.statistics.map((item) => [item.dataRevision, item.playthroughId, item.encounters, item.win])).toEqual([
        ['r1', 'p1', 3, 3],
        ['r1', 'p2', 1, 1],
        ['r2', 'p1', 1, 1],
      ])
      expect(store.load('other-game').battleRecording!.statistics).toEqual([])
      expect(() => other.commit('other-game', batch('bad', [start()]))).toThrow('bound')
      expect(() => other.commit('_global', batch('bad', [start()]))).toThrow('scope mismatch')
    } finally {
      second.db.$client.close()
    }
  })

  it('keeps source dedup and cumulative totals after detail retention and reopening', () => {
    for (let i = 0; i < 6; i++)
      store.commit(
        'game-a',
        batch(
          `chunk-${i}`,
          Array.from({ length: 100 }, (_, j) => start(`enc-${i * 100 + j}`))
        )
      )
    connection.db.$client.close()
    connection = openCompanionMemoryDb(path.join(root, 'companion.sqlite'))
    store = createCompanionSqliteStore(connection.db)
    store.commit('game-a', batch('old-source-new-batch', [start('enc-0')]))
    const recording = store.load('game-a').battleRecording!
    expect(recording.statistics[0]).toMatchObject({ encounters: 600, unknown: 600 })
    expect(recording.recentEvents).toHaveLength(512)
    expect(recording.detailsTrimmed).toBe(true)
    expect(recording.recentEvents.some((event) => event.encounterId === 'enc-0')).toBe(false)
  })

  it('enforces service-issued exact versions and idempotent management, including ambiguous retries', () => {
    store.commit('game-a', batch('a', [start()]))
    const off = management('off', { action: 'set_recording', enabled: false })
    expect(store.manage('game-a', off)).toEqual({ memoryEpoch: 1, recordingRevision: 2, recordingEnabled: false })
    expect(() => store.commit('game-a', batch('old', [start('old')]))).toThrow('version changed')
    expect(() => store.commit('game-a', batch('future', [], { memoryEpoch: 9, recordingRevision: 9 }))).toThrow('version changed')
    expect(() => store.commit('game-a', batch('disabled', [start('disabled')], { memoryEpoch: 1, recordingRevision: 2 }))).toThrow('disabled')
    expect(() => store.commit('game-a', { ...batch('legacy', [], { memoryEpoch: 1, recordingRevision: 2 }), setRecording: true })).toThrow('management')
    expect(() => store.manage('game-a', management('stale-clear', { action: 'clear' }))).toThrow('version changed')
    store.manage('game-a', management('on', { action: 'set_recording', enabled: true }, 1, 2))
    // An old successful request returns its original response without reverting the current state.
    expect(store.manage('game-a', off).recordingEnabled).toBe(false)
    expect(store.load('game-a')).toMatchObject({ recordingEnabled: true, recordingRevision: 3 })
    expect(() => store.manage('game-a', { ...off, action: 'set_recording', enabled: true })).toThrow('conflict')
    store.commit('game-a', batch('new', [start('new')], { memoryEpoch: 1, recordingRevision: 3 }))
    expect(store.load('game-a').battleRecording!.statistics[0].encounters).toBe(2)
  })

  it('clears durable records atomically, keeps preferences by default, and fences unsynchronized writers', () => {
    const first = batch('a', [start(), finish()])
    first.preferences = [{ libraryGameId: 'game-a', source: 'user_settings', key: 'verbosity', value: 'quiet', revision: 1, updatedAt: 100 }]
    first.episodes = [{ episodeId: 'ep1', scope, at: 100, kind: 'battle_result', persistence: 'committed', completeness: 'partial', summary: 'Won', evidence: [], memoryEpoch: 1 }]
    store.commit('game-a', first)
    store.manage('game-a', management('clear', { action: 'clear' }))
    expect(store.load('game-a')).toMatchObject({ memoryEpoch: 2, episodes: [], evidence: [], battleRecording: { statistics: [], recentEvents: [] } })
    expect(store.load('game-a').preferences).toHaveLength(1)
    expect(store.commit('game-a', first)).toMatchObject({ duplicated: true })
    expect(() => store.commit('game-a', batch('late', [start('late')]))).toThrow('version changed')
    store.manage('game-a', management('clear-prefs', { action: 'clear', preferences: true }, 2))
    expect(store.load('game-a').preferences).toEqual([])
    const counts = ['companion_record_sources', 'companion_record_details', 'companion_encounter_totals', 'companion_episodes', 'companion_evidence']
    for (const table of counts) expect(connection.db.$client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 })
    expect(connection.db.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects malformed or oversized recording schemas before mutating storage', () => {
    for (const events of [
      Array.from({ length: 129 }, () => start()),
      [{ ...start(), at: NaN }],
      [{ ...start(), scope: { ...scope, segmentId: '' } }],
      [{ kind: 'action_result', eventId: 'wrong', scope, encounterId: 'enc-1', at: 1, result: { resultId: 'right', observedAt: 1 } }],
    ]) {
      expect(() => store.commit('game-a', batch('invalid', events as BattleRecordEvent[]))).toThrow()
      expect(store.load('game-a').battleRecording!.statistics).toEqual([])
    }
  })
})
