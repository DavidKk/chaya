import { eventPassesSpec, parseInteractBatchSpec, sanitizeSpecIds } from '@/lib/game-agent/jobs'

test('parses a many-target batch spec', () => {
  const parsed = parseInteractBatchSpec(
    JSON.stringify({
      kind: 'interact_batch',
      scope: 'visible_map',
      includeKinds: 'all',
      excludeKinds: ['npc', 'exit'],
      includeEventIds: [],
      excludeEventIds: [],
      cardinality: 'many',
      onChoice: 'ask_player',
      summary: '除人物与入口外都交互',
    })
  )
  expect(parsed).toMatchObject({ ok: true, spec: { cardinality: 'many', excludeKinds: ['npc', 'exit'] } })
})

test('rejects cardinality one so the caller can fall back to single', () => {
  expect(
    parseInteractBatchSpec(
      JSON.stringify({
        kind: 'interact_batch',
        scope: 'visible_map',
        includeKinds: ['pickup'],
        excludeKinds: [],
        includeEventIds: [3],
        excludeEventIds: [],
        cardinality: 'one',
        onChoice: 'ask_player',
        summary: '打开那个箱子',
      })
    )
  ).toMatchObject({ ok: false, reason: 'cardinality_one' })
})

test('drops unknown ids and applies exclude before include-all', () => {
  const parsed = parseInteractBatchSpec(
    JSON.stringify({
      kind: 'interact_batch',
      scope: 'visible_map',
      includeKinds: 'all',
      excludeKinds: ['npc'],
      includeEventIds: [1, 99],
      excludeEventIds: [2],
      cardinality: 'many',
      onChoice: 'ask_player',
      summary: 'test',
    })
  )
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  const spec = sanitizeSpecIds(parsed.spec, new Set([1, 2, 3]))
  expect(spec.includeEventIds).toEqual([1])
  expect(spec.excludeEventIds).toEqual([2])
  expect(eventPassesSpec({ eventId: 1, normalizedKind: 'pickup', interactive: true, opened: false }, spec)).toBe('execute')
  expect(eventPassesSpec({ eventId: 2, normalizedKind: 'pickup', interactive: true, opened: false }, spec)).toBe('exclude')
  expect(eventPassesSpec({ eventId: 3, normalizedKind: 'npc', interactive: true, opened: false }, spec)).toBe('exclude')
  const openAll = { ...spec, includeEventIds: [] }
  expect(eventPassesSpec({ eventId: 4, normalizedKind: 'unknown', interactive: true, opened: false }, openAll)).toBe('deferred')
})
