import { battleFrame, runningCoordinator } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { chooseAction } from '@/lib/game-agent/companion/core/action-selector'
import { evaluateSituation } from '@/lib/game-agent/companion/core/situation'
import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'
import type { FactView } from '@/lib/game-agent/companion/types'
import { createBattleIntents } from '@/plugins/mv/src/agent/runtime/companion-core/battle-intents'
import type { CompanionBattleRuntime } from '@/plugins/mv/src/agent/runtime/companion-core/runtime'

const candidate = (kind = 'reserve_mp', param = 10, quote = '保留10MP') => ({ clarify: false, constraints: [{ kind, param, quote }] })
function setup() {
  const { coordinator, arbiter } = runningCoordinator()
  const controller = new AbortController()
  const facts = {
    stamp: battleFrame().stamp,
    capabilities: { battle: true },
    current: { encounterId: { value: 'enc-1' }, enemies: { value: [{ enemyId: 10, name: 'Slime' }] }, legalActions: { value: [{ kind: 'item', id: 5, name: 'Potion' }] } },
    mechanics: { skills: { '1': { skillId: 1, name: 'Attack' } } },
  } as unknown as FactView
  let now = 100
  const runtime = {
    coordinator,
    arbiter,
    getStatus: () => coordinator.getStatus(),
    addPlayerConstraint: coordinator.addPlayerConstraint.bind(coordinator),
  } as CompanionBattleRuntime
  const intents = createBattleIntents({ runtime, signal: controller.signal, currentFacts: () => facts, now: () => now })
  return {
    coordinator,
    arbiter,
    controller,
    facts,
    intents,
    advance: () => {
      now += 10001
    },
  }
}

test('initial explicit constraints are installed while idle, before control begins', () => {
  const s = setup()
  s.coordinator.stop()
  const receipt = s.intents.begin('task', '保留10MP', true)!
  expect(receipt.accept(candidate())).toBe('applied')
  expect(s.coordinator.getPlayerConstraints()).toEqual([{ id: 'player:reserve_mp', kind: 'reserve_mp', param: 10 }])
  expect(s.coordinator.getStatus()).toBe('idle')
  expect(receipt.accept(candidate())).toBe('stale')
  expect(s.intents.begin('task', '保留10MP', true)).toBeNull()
})

test('newer requests replace older requests and named reserve values, without removing prohibitions', () => {
  const s = setup()
  s.coordinator.addPlayerConstraint({ id: 'player:forbid_skill:1', kind: 'forbid_skill', param: 1 })
  const old = s.intents.begin('old', '保留10MP')!
  const newer = s.intents.begin('new', '保留20MP')!
  expect(old.accept(candidate())).toBe('stale')
  expect(newer.accept(candidate('reserve_mp', 20, '保留20MP'))).toBe('applied')
  const last = s.intents.begin('last', '保留10MP')!
  expect(last.accept(candidate())).toBe('applied')
  expect(s.coordinator.getPlayerConstraints()).toEqual([
    { id: 'player:forbid_skill:1', kind: 'forbid_skill', param: 1 },
    { id: 'player:reserve_mp', kind: 'reserve_mp', param: 10 },
  ])
})

test.each(['abort', 'stop', 'epoch', 'scope', 'goal', 'deadline', 'encounter', 'capabilities'] as const)('rejects %s changes during extraction', (change) => {
  const s = setup()
  const receipt = s.intents.begin('1', '保留10MP')!
  if (change === 'abort') s.controller.abort()
  if (change === 'stop') s.coordinator.stop()
  if (change === 'epoch') s.facts.stamp.contextEpoch++
  if (change === 'scope') s.facts.stamp.scope.segmentId = 'new'
  if (change === 'goal') s.coordinator.addPlayerConstraint({ id: 'other', kind: 'reserve_mp', param: 2 })
  if (change === 'deadline') s.advance()
  if (change === 'encounter') s.facts.current.encounterId.value = 'enc-2'
  if (change === 'capabilities') s.facts.mechanics.skills = {}
  expect(receipt.accept(candidate())).toBe('stale')
  expect(s.coordinator.getPlayerConstraints().some((entry) => entry.id === 'player:reserve_mp')).toBe(false)
})

test('chat with no constraints survives battle progress and completion without mutating tactics', () => {
  const s = setup()
  const receipt = s.intents.begin('chat', '今天过得怎么样？')!
  s.facts.mechanics.skills = {}
  s.facts.current.encounterId.value = 'enc-2'
  s.coordinator.stop()
  s.advance()
  expect(receipt.accept({ clarify: false, constraints: [] })).toBe('none')
  expect(s.coordinator.getPlayerConstraints()).toEqual([])
  expect(receipt.accept({ clarify: false, constraints: [] })).toBe('stale')
})

test.each(['abort', 'newer', 'epoch', 'scope'] as const)('empty extraction still rejects %s invalidation', (change) => {
  const s = setup()
  const receipt = s.intents.begin('chat', '今天过得怎么样？')!
  if (change === 'abort') s.controller.abort()
  if (change === 'newer') s.intents.begin('new', '保留10MP')
  if (change === 'epoch') s.facts.stamp.contextEpoch++
  if (change === 'scope') s.facts.stamp.scope.segmentId = 'new'
  expect(receipt.accept({ clarify: false, constraints: [] })).toBe('stale')
})

test.each([
  candidate('forbid_skill', 99),
  candidate('focus_enemy', 99),
  candidate('forbid_item', 99),
  candidate('reserve_mp', 10, '不存在的原话'),
  candidate('resume_control', 1),
  { ...candidate(), extra: true },
  { clarify: false, constraints: [{ kind: 'reserve_mp', param: 10, quote: '保留10MP', extra: true }] },
])('rejects unsupported or fabricated candidates atomically', (value) => {
  const s = setup()
  const receipt = s.intents.begin('1', '保留10MP')!
  expect(receipt.accept(value)).toBe('clarify')
  expect(s.coordinator.getPlayerConstraints()).toEqual([])
})

test('an invalid second candidate cannot partially install the first', () => {
  const s = setup()
  expect(
    s.intents.begin('1', '保留10MP')!.accept({
      clarify: false,
      constraints: [...candidate().constraints, ...candidate('forbid_skill', 99).constraints],
    })
  ).toBe('clarify')
  expect(s.coordinator.getPlayerConstraints()).toEqual([])
})

test.each(['forbid_skill', 'focus_enemy', 'forbid_item', 'reserve_mp'])('rejects %s invented from a generic delegation quote', (kind) => {
  const s = setup()
  const prompt = '请一直帮我处理遇到的战斗，直到我叫停。'
  const id = { forbid_skill: 1, focus_enemy: 10, forbid_item: 5, reserve_mp: 20 }[kind]!
  expect(s.intents.begin('1', prompt)!.accept(candidate(kind, id, prompt))).toBe('clarify')
  expect(s.coordinator.getPlayerConstraints()).toEqual([])
})

test.each([
  ['forbid_skill', 1, '不要使用Attack'],
  ['focus_enemy', 10, 'Focus Slime'],
  ['forbid_item', 5, 'Do not use item 5'],
])('accepts explicit %s references', (kind, id, prompt) => {
  const s = setup()
  expect(s.intents.begin('1', String(prompt))!.accept(candidate(String(kind), Number(id), String(prompt)))).toBe('applied')
})

test('cannot turn a quoted amount into a different reserve value', () => {
  const s = setup()
  expect(s.intents.begin('1', '保留100MP')!.accept(candidate('reserve_mp', 10, '保留100MP'))).toBe('clarify')
  expect(s.coordinator.getPlayerConstraints()).toEqual([])
})

test.each(['', '   '])('an unnamed target cannot match any delegation quote', (name) => {
  const s = setup()
  s.facts.mechanics.skills['1'].name = name
  const prompt = '请帮我处理战斗'
  expect(s.intents.begin('1', prompt)!.accept(candidate('forbid_skill', 1, prompt))).toBe('clarify')
  expect(s.coordinator.getPlayerConstraints()).toEqual([])
})

test('an item without a display name can only match its explicit numeric ID', () => {
  const s = setup()
  s.facts.current.legalActions.value = [{ kind: 'item', id: 5 }] as NonNullable<FactView['current']['legalActions']['value']>
  const prompt = '请帮我处理战斗'
  expect(s.intents.begin('generic', prompt)!.accept(candidate('forbid_item', 5, prompt))).toBe('clarify')
  expect(s.intents.begin('explicit', '不要使用物品5')!.accept(candidate('forbid_item', 5, '不要使用物品5'))).toBe('applied')
})

test('capacity rejection preserves every existing constraint', () => {
  const s = setup()
  for (let i = 0; i < 32; i++) s.coordinator.addPlayerConstraint({ id: `c${i}`, kind: 'forbid_item', param: i + 1 })
  const before = s.coordinator.getPlayerConstraints()
  expect(s.intents.begin('1', '保留10MP')!.accept(candidate())).toBe('clarify')
  expect(s.coordinator.getPlayerConstraints()).toEqual(before)
})

test('all-item prohibition is enforced by the local selector', () => {
  const frame = battleFrame()
  frame.party[0].hp = 10
  frame.offers = [{ ...frame.offers[0], kind: 'item', abilityId: 5, effect: { kind: 'heal' }, targetRule: 'one_ally' }]
  expect(chooseAction(frame, evaluateSituation(frame), DEFAULT_TACTIC_PLAN).kind).toBe('action')
  const result = chooseAction(frame, evaluateSituation(frame, [], [{ id: 'all', kind: 'forbid_item', param: 0 }]), DEFAULT_TACTIC_PLAN)
  expect(result.kind).toBe('blocked')
})
