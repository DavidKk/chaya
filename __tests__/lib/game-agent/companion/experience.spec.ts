import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import { BattleRecordingExperience } from '@/lib/game-agent/companion/memory-recording'
import { createGameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { ActionEvidence } from '@/lib/game-agent/companion/types'

import { experienceBatch, experienceScope as scope, hpResult } from './experience-fixtures'

const targets = [
  { kind: 'actor' as const, id: 1, hp: 100, hpMax: 100, stateIds: [] },
  { kind: 'enemy' as const, id: 10, hp: null, hpMax: null, stateIds: [] },
]

test('actual HP observations acquire conditional support, survive replay order, and retain verifiable references', () => {
  const projection = new BattleRecordingExperience()
  const events = [hpResult(0), hpResult(1, { hpAfter: 85 }), hpResult(2)]
  projection.append(events.slice(0, 2))
  expect(projection.queryExperiences(scope).experiences[0].status).toBe('observation_summary')
  projection.append(events)
  const experience = projection.queryExperiences(scope, { targets }).experiences[0]
  expect(experience).toMatchObject({
    status: 'conditionally_supported',
    applicability: 'matching_observed_conditions',
    claim: 'hp_decreased',
    sampleActions: 3,
    sampleEncounters: 2,
    targetResults: 3,
    hpLoss: { min: 10, max: 15 },
    evidenceRefs: [{ scope, eventId: 'result-0', hpBefore: 100, hpAfter: 90 }, {}, {}],
  })
  expect(experience.summary).not.toContain('999')
  const restored = new BattleRecordingExperience()
  restored.append([...events].reverse())
  expect(restored.queryExperiences(scope, { targets })).toEqual(projection.queryExperiences(scope, { targets }))
})

test('one multi-target or repeated-hit action cannot meet the independent-action threshold', () => {
  const projection = new BattleRecordingExperience()
  projection.append(
    Array.from({ length: 8 }, (_, i) => hpResult(i, { actionId: 'one-action', target: { kind: 'actor', id: 1, instance: `actor:${i}` } }, { encounterId: 'one-encounter' }))
  )
  expect(projection.queryExperiences(scope).experiences[0]).toMatchObject({ sampleActions: 1, sampleEncounters: 1, targetResults: 8, status: 'observation_summary' })
})

test.each([100, 105])('zero or opposite HP change %s immediately downgrades a supported direction', (hpAfter) => {
  const projection = new BattleRecordingExperience()
  projection.append([hpResult(0), hpResult(1), hpResult(2)])
  // Keep the same valid bounds while testing healing as a counterexample.
  projection.append([hpResult(3, { hpBefore: 90, hpAfter: hpAfter === 105 ? 100 : 90 })])
  const experience = projection.queryExperiences(scope).experiences[0]
  expect(experience).toMatchObject({ status: 'has_counterexamples', supportingResults: 3, counterexampleResults: 1, claim: 'hp_decreased' })
  expect(experience.counterexampleRefs[0]).toMatchObject({ eventId: 'result-3' })
  expect(experience.summary).toContain('反例')
})

test('healing records actual capped recovery and does not treat reported damage as an effect estimate', () => {
  const projection = new BattleRecordingExperience()
  projection.append([hpResult(0, { hpBefore: 95, hpAfter: 100, reportedHpDamage: -1000 })])
  expect(projection.queryExperiences(scope).experiences[0]).toMatchObject({ claim: 'hp_increased', hpLoss: { min: -5, max: -5 }, status: 'observation_summary' })
})

test('all-zero results remain observations rather than proof of immunity or skill failure', () => {
  const projection = new BattleRecordingExperience()
  projection.append([0, 1, 2].map((i) => hpResult(i, { hpAfter: 100 })))
  expect(projection.queryExperiences(scope).experiences[0]).toMatchObject({ claim: 'hp_unchanged', status: 'observation_summary', counterexampleResults: 0 })
})

test.each([
  { hpBefore: null },
  { hpAfter: null },
  { attribution: 'unknown' },
  { source: { kind: 'unknown' } },
  { ability: undefined },
  { hpBefore: -1 },
  { hpAfter: 101 },
] as Partial<ActionEvidence>[])('unknown or invalid evidence is excluded: %j', (facts) => {
  const projection = new BattleRecordingExperience()
  projection.append([hpResult(0, facts)])
  expect(projection.queryExperiences(scope).experiences).toEqual([])
})

test('missing target conditions cannot acquire support and are distinct from known empty states', () => {
  const projection = new BattleRecordingExperience()
  projection.append([0, 1, 2].map((i) => hpResult(i, { stateIdsBefore: undefined })))
  projection.append([hpResult(3)])
  const results = projection.queryExperiences(scope, { targets }).experiences
  expect(results).toHaveLength(2)
  expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ sampleActions: 3, status: 'observation_summary', applicability: 'unknown' })]))
  expect(results[0]).toMatchObject({ sampleActions: 1, applicability: 'matching_observed_conditions' })
})

test('conditions partition state sets, HP bands, HP maxima and ability kinds, with current applicability checked separately', () => {
  const projection = new BattleRecordingExperience()
  projection.append([
    hpResult(0),
    hpResult(1, { stateIdsBefore: [4, 2, 4] }),
    hpResult(2, { stateIdsBefore: [2, 4] }),
    hpResult(3, { hpBefore: 25, hpAfter: 20 }),
    hpResult(4, { hpMax: 200 }),
    hpResult(5, { ability: { kind: 'item', id: 1 } }),
  ])
  expect(projection.queryExperiences(scope, { limit: 8 }).experiences).toHaveLength(5)
  const results = projection.queryExperiences(scope, { targets, skillIds: [1], limit: 8 }).experiences
  expect(results).toHaveLength(4)
  expect(results[0]).toMatchObject({ conditions: { hpMax: 100, stateIds: [], hpBand: 'high' }, applicability: 'matching_observed_conditions' })
  expect(results.slice(1).every((item) => item.applicability === 'conditions_differ')).toBe(true)
  expect(results.slice(1).every((item) => item.summary.includes('不适用'))).toBe(true)
})

test('historical support does not fill gaps in the current target or apply without the observed source', () => {
  const projection = new BattleRecordingExperience()
  projection.append([0, 1, 2].map((i) => hpResult(i)))
  for (const missing of [{ hp: null }, { hpMax: null }, { stateIds: null }]) {
    const current = [{ ...targets[0], ...missing }, targets[1]]
    expect(projection.queryExperiences(scope, { targets: current }).experiences[0]).toMatchObject({
      status: 'conditionally_supported',
      applicability: 'unknown',
    })
  }
  expect(projection.queryExperiences(scope, { targets: [targets[0]] }).experiences[0]).toMatchObject({
    status: 'conditionally_supported',
    applicability: 'conditions_differ',
  })
})

test('game, revision and playthrough are isolated; runtime/segment identities distinguish encounters during conditional reuse', () => {
  const projection = new BattleRecordingExperience()
  const events = (['libraryGameId', 'dataRevision', 'playthroughId', 'runtimeInstanceId', 'segmentId'] as const).map((field) =>
    hpResult(0, {}, { scope: { ...scope, [field]: 'other' } })
  )
  projection.append([hpResult(0), ...events])
  const item = projection.queryExperiences(scope).experiences[0]
  expect(item).toMatchObject({ sampleActions: 3, sampleEncounters: 3, targetResults: 3 })
  expect(item.evidenceRefs).toHaveLength(3)
  expect(projection.queryExperiences(scope, { enemyIds: [99] }).experiences).toEqual([])
})

test('queries return detached data and bounded results, while retention is explicitly partial', () => {
  const projection = new BattleRecordingExperience()
  projection.append(Array.from({ length: 600 }, (_, i) => hpResult(i, { ability: { kind: 'skill', id: (i % 12) + 1 } })))
  expect(projection.queryExperiences(scope, { limit: 999 })).toMatchObject({ detailsTrimmed: true, coverage: 'retained_observations', experiences: expect.any(Array) })
  expect(projection.queryExperiences(scope, { limit: 999 }).experiences).toHaveLength(8)
  const query = projection.queryExperiences(scope)
  query.experiences[0].conditions.stateIds!.push(99)
  query.experiences[0].evidenceRefs[0].scope.libraryGameId = 'changed'
  expect(projection.queryExperiences(scope)).not.toEqual(query)
  projection.clear('g1', 2)
  expect(projection.queryExperiences(scope)).toMatchObject({ memoryEpoch: 2, experiences: [] })
})

test('snapshot restore, recording changes and clear reuse the existing acknowledgement and version barriers', async () => {
  const store = createGameplayMemoryStore({
    backend: {
      ready: async () => {},
      flush: async () => {},
      loadSnapshot: async () => ({
        ...emptyMemorySnapshot(),
        battleRecording: { schemaVersion: 1, projectionVersion: 1, coverage: 'observed_only', statistics: [], detailsTrimmed: false, recentEvents: [hpResult(0)] },
      }),
      commitBatch: async () => {},
      clearQueueBarrier: async () => {},
    },
  })
  try {
    expect(store.queryExperiences(scope).experiences).toEqual([])
    await store.ready()
    expect(store.queryExperiences(scope).experiences[0].sampleActions).toBe(1)
    await store.setRecording(false)
    expect(store.acceptCommittedRecording(experienceBatch([hpResult(1)], store.getEpoch(), store.getRecordingRevision()))).toBe(false)
    expect(store.queryExperiences(scope).experiences[0].sampleActions).toBe(1)
    await store.setRecording(true)
    expect(store.acceptCommittedRecording(experienceBatch([hpResult(1)], store.getEpoch(), store.getRecordingRevision() - 1))).toBe(false)
    await store.clearMemory()
    expect(store.queryExperiences(scope)).toMatchObject({ memoryEpoch: 2, experiences: [] })
    expect(store.acceptCommittedRecording(experienceBatch([hpResult(2)]))).toBe(false)
    expect(store.acceptCommittedRecording(experienceBatch([hpResult(2)], store.getEpoch(), store.getRecordingRevision()))).toBe(true)
    expect(store.queryExperiences(scope).experiences[0]).toMatchObject({ memoryEpoch: 2, sampleActions: 1 })
  } finally {
    await store.close()
  }
})
