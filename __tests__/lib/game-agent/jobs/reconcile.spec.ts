import { type JobIo, type JobResult, type JobRun, mergeCandidates, pickNext, remainingJobs, runJobs } from '@/lib/game-agent/jobs'

function baseRun(overrides: Partial<JobRun> = {}): JobRun {
  return {
    spec: {
      kind: 'interact_batch',
      scope: 'visible_map',
      includeKinds: 'all',
      excludeKinds: ['npc', 'exit'],
      includeEventIds: [],
      excludeEventIds: [],
      cardinality: 'many',
      onChoice: 'ask_player',
      summary: '除人物与入口外都交互',
    },
    specVersion: 1,
    boundary: {
      runtimeInstanceId: 'rt-1',
      startMapId: 1,
      startVisibleBounds: { minX: 0, maxX: 20, minY: 0, maxY: 20 },
    },
    candidates: new Map(),
    ledger: new Map(),
    failures: new Map(),
    log: [],
    attempts: 0,
    deadline: Date.now() + 60_000,
    ...overrides,
  }
}

function stateWith(events: Array<Record<string, unknown>>, player = { x: 5, y: 5 }) {
  return {
    scene: 'Scene_Map',
    map: { id: 1, visibleBounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 } },
    player,
    nearbyEvents: events,
  }
}

test('keeps start-bound candidates after the camera nearby set shrinks', () => {
  const run = baseRun()
  mergeCandidates(
    run,
    stateWith([
      { id: 1, kind: 'pickup', x: 2, y: 2, interactive: true, routeStatus: 'reachable', routeDistance: 1 },
      { id: 2, kind: 'object', x: 18, y: 18, interactive: true, routeStatus: 'reachable', routeDistance: 8 },
    ])
  )
  expect(run.candidates.size).toBe(2)
  mergeCandidates(run, stateWith([{ id: 1, kind: 'pickup', x: 2, y: 2, interactive: true, routeStatus: 'reachable', routeDistance: 1 }]))
  expect(run.candidates.has(2)).toBe(true)
  expect(
    remainingJobs(run)
      .map((job) => job.eventId)
      .sort()
  ).toEqual([1, 2])
})

test('does not complete while unknown kinds remain deferred', () => {
  const run = baseRun()
  mergeCandidates(run, stateWith([{ id: 9, kind: 'unknown', x: 3, y: 3, interactive: true, routeStatus: 'reachable', routeDistance: 1 }]))
  expect(remainingJobs(run)).toEqual([])
  expect(run.candidates.get(9)?.deferred).toBe('uncertain_kind')
})

test('excludes page-changed settled events and prefers nearer targets', () => {
  const run = baseRun()
  mergeCandidates(
    run,
    stateWith([
      { id: 1, kind: 'pickup', x: 2, y: 2, interactive: true, routeStatus: 'reachable', routeDistance: 5 },
      { id: 2, kind: 'object', x: 3, y: 3, interactive: true, routeStatus: 'reachable', routeDistance: 1 },
    ])
  )
  run.ledger.set('1:1', { status: 'done', note: 'done' })
  const jobs = remainingJobs(run)
  expect(jobs.map((job) => job.eventId)).toEqual([2])
  expect(pickNext(jobs, run)?.eventId).toBe(2)
})

test('runJobs settles reachable targets without model calls', async () => {
  const run = baseRun()
  mergeCandidates(
    run,
    stateWith([
      { id: 1, kind: 'pickup', x: 2, y: 2, interactive: true, routeStatus: 'reachable', routeDistance: 1 },
      { id: 2, kind: 'npc', x: 4, y: 4, interactive: true, routeStatus: 'reachable', routeDistance: 2 },
    ])
  )
  const results = new Map<number, JobResult>([
    [
      1,
      {
        status: 'done',
        evidence: {
          messages: [],
          goldChange: 10,
          inventoryChanges: [],
          historyRange: { fromSeq: 1, toSeq: 1 },
          completeness: { messagesTruncated: false, historyGap: false },
        },
      },
    ],
  ])
  let observations = 0
  const io: JobIo = {
    checkAbortAndBudget() {},
    async observe() {
      observations += 1
      return stateWith([
        {
          id: 1,
          kind: 'pickup',
          x: 2,
          y: 2,
          interactive: true,
          opened: observations > 1,
          routeStatus: 'reachable',
          routeDistance: observations > 1 ? 0 : 1,
        },
      ])
    },
    withinBoundary: () => true,
    async interact(job) {
      return results.get(job.eventId) || { status: 'skipped', reason: 'gone' }
    },
    async continuePending() {
      return {
        status: 'done',
        evidence: { messages: [], goldChange: 0, inventoryChanges: [], historyRange: { fromSeq: null, toSeq: 0 }, completeness: { messagesTruncated: false, historyGap: false } },
      }
    },
    createPending(job, result, version) {
      return { job, reason: result.reason, version }
    },
    async askPlayer() {
      return 'stop'
    },
  }
  const outcome = await runJobs(run, io, new AbortController().signal)
  expect(outcome.status).toBe('completed')
  expect(run.ledger.get('1:1')?.status).toBe('done')
})
