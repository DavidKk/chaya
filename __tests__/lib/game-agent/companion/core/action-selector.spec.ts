import { chooseAction } from '@/lib/game-agent/companion/core/action-selector'
import { evaluateSituation } from '@/lib/game-agent/companion/core/situation'
import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'
import type { BattleEnemyEntity, BattleFrame, BattlePartyEntity } from '@/lib/game-agent/companion/core/types'

describe('ActionSelector', () => {
  const party: BattlePartyEntity[] = [
    { actorId: 1, name: 'Hero', index: 0, hp: 80, hpMax: 100, mp: 30, mpMax: 50, tp: 0, isDead: false, states: [] },
    { actorId: 2, name: 'Cleric', index: 1, hp: 20, hpMax: 100, mp: 40, mpMax: 60, tp: 0, isDead: false, states: [] },
  ]

  const enemies: BattleEnemyEntity[] = [{ enemyId: 10, instanceId: 'enemy:0', name: 'Goblin', index: 0, hp: 45, hpMax: 50, isDead: false, states: [] }]

  test('selects fight in party_command phase', () => {
    const frame: BattleFrame = {
      stamp: {
        scope: { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'i1', segmentId: 's1' },
        contextEpoch: 1,
        factsRevision: 1,
      },
      encounterId: 'enc-1',
      turnCount: 1,
      phase: 'party_command',
      opportunity: { opportunityId: 'party:1', actor: null, actionSlot: null, kind: 'party' },
      party,
      enemies,
      offers: [
        {
          actionKey: 'party:fight',
          actor: null,
          kind: 'attack',
          name: '战斗',
          targetRule: 'none',
          costs: { mp: 0, tp: 0 },
          effect: { kind: 'other' },
        },
      ],
      capabilitiesRevision: 1,
    }

    const situation = evaluateSituation(frame)
    const result = chooseAction(frame, situation, DEFAULT_TACTIC_PLAN)
    expect(result.kind).toBe('action')
    if (result.kind === 'action') {
      expect(result.intent.actionOffer.actionKey).toBe('party:fight')
    }
  })

  test('triggers heal rule when ally HP is below threshold', () => {
    const frame: BattleFrame = {
      stamp: {
        scope: { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'i1', segmentId: 's1' },
        contextEpoch: 1,
        factsRevision: 1,
      },
      encounterId: 'enc-1',
      turnCount: 1,
      phase: 'actor_command',
      opportunity: {
        opportunityId: 'actor:2:slot:0',
        actor: { kind: 'actor', id: 2, instance: 'actor:2' },
        actionSlot: 0,
        kind: 'actor',
      },
      party,
      enemies,
      offers: [
        {
          actionKey: 'actor:2:attack',
          actor: { kind: 'actor', id: 2, instance: 'actor:2' },
          kind: 'attack',
          name: '攻击',
          targetRule: 'one_enemy',
          costs: { mp: 0, tp: 0 },
          effect: { kind: 'damage' },
        },
        {
          actionKey: 'actor:2:skill:10',
          actor: { kind: 'actor', id: 2, instance: 'actor:2' },
          kind: 'skill',
          abilityId: 10,
          name: '治愈术',
          targetRule: 'one_ally',
          costs: { mp: 5, tp: 0 },
          effect: { kind: 'heal' },
        },
      ],
      capabilitiesRevision: 1,
    }

    const situation = evaluateSituation(frame)
    const result = chooseAction(frame, situation, DEFAULT_TACTIC_PLAN)
    expect(result.kind).toBe('action')
    if (result.kind === 'action') {
      expect(result.intent.actionOffer.kind).toBe('skill')
      expect(result.intent.actionOffer.abilityId).toBe(10)
      expect(result.intent.target.entityId).toBe(2) // Targets Cleric (20/100 HP)
    }
  })

  test('falls back to attack when no emergency healing needed', () => {
    const fullHpParty: BattlePartyEntity[] = [{ actorId: 1, name: 'Hero', index: 0, hp: 100, hpMax: 100, mp: 30, mpMax: 50, tp: 0, isDead: false, states: [] }]
    const frame: BattleFrame = {
      stamp: {
        scope: { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'i1', segmentId: 's1' },
        contextEpoch: 1,
        factsRevision: 1,
      },
      encounterId: 'enc-1',
      turnCount: 1,
      phase: 'actor_command',
      opportunity: {
        opportunityId: 'actor:1:slot:0',
        actor: { kind: 'actor', id: 1, instance: 'actor:1' },
        actionSlot: 0,
        kind: 'actor',
      },
      party: fullHpParty,
      enemies,
      offers: [
        {
          actionKey: 'actor:1:attack',
          actor: { kind: 'actor', id: 1, instance: 'actor:1' },
          kind: 'attack',
          name: '攻击',
          targetRule: 'one_enemy',
          costs: { mp: 0, tp: 0 },
          effect: { kind: 'damage' },
        },
      ],
      capabilitiesRevision: 1,
    }

    const situation = evaluateSituation(frame)
    const result = chooseAction(frame, situation, DEFAULT_TACTIC_PLAN)
    expect(result.kind).toBe('action')
    if (result.kind === 'action') {
      expect(result.intent.actionOffer.kind).toBe('attack')
      expect(result.intent.target.entityId).toBe(10)
    }
  })
})
