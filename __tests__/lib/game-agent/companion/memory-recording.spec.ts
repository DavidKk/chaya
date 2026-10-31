import { validateBattleRecord } from '@/lib/game-agent/companion/core/recording-schema'
import type { BattleRecordEvent, BattleRecordingSnapshot } from '@/lib/game-agent/companion/core/recording-types'
import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import { BattleRecordingExperience } from '@/lib/game-agent/companion/memory-recording'
import { validateEpisode } from '@/lib/game-agent/companion/memory-schema'
import { createGameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { MemoryBackend, MemoryEpisodeRecord, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import type { ActionEvidence } from '@/lib/game-agent/companion/types'

const scope = { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'inst-1', segmentId: 's1' }
const base = { scope, encounterId: 'enc-1', at: 10 }
const evidence = (resultId = 'r1', targetId = 10): ActionEvidence => ({
  actionId: 'a1',
  resultId,
  source: { kind: 'actor', id: 1 },
  target: { kind: 'enemy', id: targetId, instance: `enemy:${targetId}` },
  ability: { kind: 'skill', id: 3 },
  hpBefore: 50,
  hpAfter: 40,
  reportedHpDamage: 999,
  attribution: 'observed_action',
})
const result = (facts: ActionEvidence = evidence()): BattleRecordEvent => ({
  ...base,
  eventId: facts.resultId,
  kind: 'action_result',
  result: {
    resultId: facts.resultId,
    actionId: facts.actionId,
    targetId: facts.target.id,
    targetKind: facts.target.kind,
    observedAt: 10,
    evidence: facts,
  },
})
const finish = (outcome: 'win' | 'lose' | 'unknown' = 'win'): BattleRecordEvent => ({
  ...base,
  kind: 'encounter_finished',
  eventId: `finish:${outcome}`,
  outcome,
  turns: 3,
})
const recording = (events: BattleRecordEvent[], detailsTrimmed = false): BattleRecordingSnapshot => ({
  schemaVersion: 1,
  projectionVersion: 1,
  coverage: 'observed_only',
  statistics: [],
  recentEvents: events,
  detailsTrimmed,
})
const batch = (events: BattleRecordEvent[], memoryEpoch = 1, recordingRevision = 1): MemoryWriteBatch => ({
  schemaVersion: 1,
  batchId: 'b1',
  memoryEpoch,
  recordingRevision,
  at: 20,
  battleRecording: { schemaVersion: 1, events },
})
const legacy = (overrides: Partial<MemoryEpisodeRecord> = {}): MemoryEpisodeRecord => ({
  ...base,
  episodeId: 'legacy-result',
  memoryEpoch: 1,
  persistence: 'committed',
  kind: 'battle_result',
  completeness: 'complete_for_claim',
  summary: '战斗胜利',
  evidence: [evidence()],
  outcome: 'win',
  ...overrides,
})

describe('canonical recording experiences', () => {
  it('preserves multi-target evidence and stable references while upgrading an unknown result', () => {
    const projection = new BattleRecordingExperience()
    projection.replace(recording([result(), result(evidence('r2', 11)), finish('unknown')]), 7)
    const unknown = projection.merge([])[0]
    expect(unknown).toMatchObject({ completeness: 'unknown', memoryEpoch: 7, persistence: 'committed' })
    expect(unknown.outcome).toBeUndefined()
    projection.append([finish(), result()])
    const episodes = projection.merge([])
    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({ episodeId: unknown.episodeId, outcome: 'win', completeness: 'partial' })
    expect(episodes[0].evidence.map((item) => item.resultId)).toEqual(['r1', 'r2'])
    expect(episodes[0].evidence[0]).toMatchObject({ hpBefore: 50, hpAfter: 40, reportedHpDamage: 999 })
    expect(() => validateEpisode(episodes[0])).not.toThrow()
  })

  it('never turns damage-only, unknown HP, zero damage, or a knockout into an inferred victory', () => {
    const projection = new BattleRecordingExperience()
    projection.append([result({ ...evidence(), hpBefore: null, hpAfter: null, reportedHpDamage: 0, attribution: 'unknown', source: { kind: 'unknown' }, ability: undefined })])
    expect(projection.merge([])).toEqual([])
    projection.append([result({ ...evidence('ko'), hpAfter: 0 })])
    expect(projection.merge([])).toEqual([expect.objectContaining({ kind: 'knockout', evidence: [expect.objectContaining({ hpBefore: 50, hpAfter: 0 })] })])
    projection.append([finish('unknown')])
    const battle = projection.merge([]).find((episode) => episode.kind === 'battle_result')!
    expect(battle.outcome).toBeUndefined()
    expect(battle.summary).toContain('结局未知')
    expect(battle.evidence[0]).toMatchObject({ hpBefore: null, hpAfter: null, source: { kind: 'unknown' } })
    expect(battle.evidence[0].ability).toBeUndefined()
  })

  it('groups by every scope field and allows queries to match only the requested game, revision and playthrough', async () => {
    const events = [
      finish(),
      ...(['libraryGameId', 'dataRevision', 'playthroughId', 'runtimeInstanceId', 'segmentId'] as const).map((key) => ({
        ...finish(),
        scope: { ...scope, [key]: 'other' },
      })),
    ]
    const store = createGameplayMemoryStore()
    store.acceptCommittedRecording(batch(events))
    expect(store.getEpisodeRecords()).toHaveLength(6)
    expect(store.queryDetailed(scope, { limit: 20 }).episodes).toHaveLength(3)
    expect(store.queryDetailed(scope, { segmentId: 's1', limit: 20 }).episodes).toHaveLength(2)
    await store.close()
  })

  it('merges legacy facts without counting a second experience or promoting pending details', () => {
    const projection = new BattleRecordingExperience()
    projection.append([result(), finish()])
    const pending = legacy({ persistence: 'pending', evidence: [evidence('unacknowledged')] })
    expect(projection.merge([pending])[0].evidence.map((item) => item.resultId)).toEqual(['r1'])
    const merged = projection.merge([legacy()])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ episodeId: 'legacy-result', persistence: 'committed', outcome: 'win' })
    expect(merged[0].evidence).toHaveLength(1)
    const knockout = { ...evidence('ko'), hpAfter: 0 }
    projection.append([result(knockout)])
    const withKnockout = projection.merge([legacy(), legacy({ episodeId: 'legacy-ko', kind: 'knockout', outcome: undefined, evidence: [evidence(), knockout] })])
    expect(withKnockout.filter((item) => item.kind === 'knockout')).toEqual([expect.objectContaining({ episodeId: 'legacy-ko' })])
  })

  it('reports contradictory committed outcomes as one unknown experience', () => {
    const projection = new BattleRecordingExperience()
    projection.append([finish()])
    const episodes = projection.merge([legacy({ outcome: 'lose' }), legacy({ episodeId: 'another' })])
    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({ completeness: 'unknown', summary: expect.stringContaining('冲突') })
    expect(episodes[0].outcome).toBeUndefined()
  })

  it('bounds retained facts and evidence, marks trimmed details, and clears only the requested game', () => {
    const projection = new BattleRecordingExperience()
    projection.append(Array.from({ length: 600 }, (_, index) => result(evidence(`r${index}`))))
    projection.append([finish(), { ...finish(), scope: { ...scope, libraryGameId: 'g2' } }])
    expect(projection.usedBytes()).toBeLessThanOrEqual(1024 * 1024)
    const battle = projection.merge([])[0]
    expect(battle).toMatchObject({ completeness: 'partial', summary: expect.stringContaining('裁剪') })
    expect(battle.evidence).toHaveLength(64)
    expect(battle.sourceEventIds!.length).toBeLessThanOrEqual(64)
    projection.clear('g1')
    expect(projection.merge([])).toEqual([expect.objectContaining({ scope: expect.objectContaining({ libraryGameId: 'g2' }) })])
    projection.clear()
    expect(projection.merge([])).toEqual([])
    expect(projection.usedBytes()).toBe(0)
  })

  it('advances projected epochs after a local clear, while rejecting the previous epoch', async () => {
    const store = createGameplayMemoryStore({
      backend: {
        ready: async () => {},
        flush: async () => {},
        loadSnapshot: async () => emptyMemorySnapshot(),
        commitBatch: async () => {},
        clearQueueBarrier: async () => {},
      },
    })
    await store.ready()
    store.acceptCommittedRecording(batch([finish()]))
    await store.clearMemory()
    expect(store.getEpisodeRecords()).toEqual([])
    expect(store.acceptCommittedRecording(batch([finish()]))).toBe(false)
    expect(store.acceptCommittedRecording(batch([finish()], store.getEpoch()))).toBe(true)
    expect(store.getEpisodeRecords()).toEqual([expect.objectContaining({ memoryEpoch: 2 })])
    await store.close()
  })
})

describe('recording evidence boundary', () => {
  it.each(['resultId', 'actionId', 'targetId', 'targetKind', 'actorId'])('rejects inconsistent %s and preserves old records without evidence', (key) => {
    const event = result()
    if (event.kind !== 'action_result') throw new Error('fixture')
    const inconsistent = { ...event.result, [key]: key === 'targetId' || key === 'actorId' ? 99 : key === 'targetKind' ? 'actor' : 'other' }
    expect(() => validateBattleRecord({ ...event, result: inconsistent })).toThrow()
    expect(validateBattleRecord({ ...event, result: { ...event.result, evidence: undefined } })).toMatchObject({ kind: 'action_result' })
  })

  it('rejects oversized or nonfinite evidence before any facts enter the cache', () => {
    const projection = new BattleRecordingExperience()
    expect(() => projection.append([finish(), result({ ...evidence(), hpAfter: NaN })])).toThrow()
    expect(projection.merge([])).toEqual([])
    expect(() => validateBattleRecord(result({ ...evidence(), target: { ...evidence().target, instance: 'x'.repeat(201) } }))).toThrow()
  })
})

test('committed projection respects durable acknowledgements, clear, recording changes and stale replies', async () => {
  let snapshot = emptyMemorySnapshot()
  let resolveCommit!: () => void
  const backend: MemoryBackend = {
    ready: async () => {},
    flush: async () => {},
    loadSnapshot: async () => snapshot,
    clearQueueBarrier: async () => {},
    commitBatch: async () => {
      await new Promise<void>((resolve) => {
        resolveCommit = resolve
      })
    },
    manage: async (request) => {
      snapshot =
        request.action === 'clear'
          ? emptyMemorySnapshot({ memoryEpoch: snapshot.memoryEpoch + 1, recordingRevision: snapshot.recordingRevision, recordingEnabled: snapshot.recordingEnabled })
          : { ...snapshot, recordingRevision: snapshot.recordingRevision + 1, recordingEnabled: request.enabled }
      return snapshot
    },
  }
  const store = createGameplayMemoryStore({ backend })
  await store.ready()
  const pending = backend.commitBatch(batch([result(), finish()])).then(() => store.acceptCommittedRecording(batch([result(), finish()])))
  expect(store.queryDetailed(scope).episodes).toEqual([])
  resolveCommit()
  await expect(pending).resolves.toBe(true)
  expect(store.queryDetailed(scope, { enemyIds: [10], skillIds: [3] }).episodes).toHaveLength(1)
  await store.clearMemory()
  expect(store.getEpisodeRecords()).toEqual([])
  expect(store.acceptCommittedRecording(batch([finish()]))).toBe(false)
  await store.setRecording(false)
  expect(store.acceptCommittedRecording(batch([finish()], store.getEpoch(), store.getRecordingRevision()))).toBe(false)
  await store.setRecording(true)
  expect(store.acceptCommittedRecording(batch([finish()], store.getEpoch(), store.getRecordingRevision() - 1))).toBe(false)
  expect(store.getEpisodeRecords()).toEqual([])
  await store.close()
})
