import { mapInteractOutcome } from '@/lib/game-agent/jobs'

const job = { key: '1:7', kind: 'interact' as const, mapId: 1, eventId: 7 }

test('maps done and blocked with blockedBy', () => {
  expect(mapInteractOutcome(job, { eventId: 7, outcome: 'done', goldChange: 1, messages: ['hi'] })).toMatchObject({
    status: 'done',
    evidence: { goldChange: 1 },
  })
  expect(
    mapInteractOutcome(job, {
      eventId: 7,
      outcome: 'no_path',
      blockedBy: [{ eventId: 3, name: 'Door' }],
    })
  ).toMatchObject({ status: 'blocked', reason: 'no_path', blockedBy: [3] })
})

test('splits busy-other from current-job input_required', () => {
  expect(
    mapInteractOutcome(job, {
      eventId: 7,
      outcome: 'input_required',
      hint: 'Finish the current dialogue or event before interacting with another target.',
    })
  ).toMatchObject({ status: 'busy_other' })
  expect(mapInteractOutcome(job, { eventId: 7, outcome: 'choice', choices: ['A', 'B'] })).toMatchObject({
    status: 'needs_decision',
    reason: 'choice',
  })
  expect(mapInteractOutcome(job, { eventId: 9, outcome: 'input_required' })).toMatchObject({ status: 'busy_other', busyEventId: 9 })
})

test('maps transfers, interrupts and battle', () => {
  expect(mapInteractOutcome(job, { eventId: 7, outcome: 'transferred' })).toMatchObject({ status: 'world_changed', reason: 'transferred' })
  expect(mapInteractOutcome(job, { eventId: 7, outcome: 'interrupted' })).toMatchObject({ status: 'stopped', reason: 'interrupted' })
  expect(mapInteractOutcome(job, { eventId: 7, outcome: 'done' }, { inBattle: true })).toMatchObject({ status: 'world_changed', reason: 'battle' })
  expect(mapInteractOutcome(job, { eventId: 7, outcome: 'done' }, { leftStartBounds: true })).toMatchObject({
    status: 'world_changed',
    reason: 'left_start_bounds',
  })
})
