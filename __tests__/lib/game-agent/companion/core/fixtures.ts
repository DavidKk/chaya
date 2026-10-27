import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import { CompanionCoordinator, type CoordinatorOptions } from '@/lib/game-agent/companion/core/coordinator'
import type { BattleFrame } from '@/lib/game-agent/companion/core/types'

export function battleFrame(overrides: Partial<BattleFrame> = {}): BattleFrame {
  return {
    stamp: { scope: { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'inst-1', segmentId: 's1' }, contextEpoch: 1, factsRevision: 1 },
    encounterId: 'enc-1',
    turnCount: 1,
    phase: 'actor_command',
    opportunity: { opportunityId: 'enc-1:turn:1:actor:1:slot:0', actor: { kind: 'actor', id: 1, instance: 'actor:1' }, actionSlot: 0, kind: 'actor' },
    party: [{ actorId: 1, name: 'Hero', index: 0, hp: 100, hpMax: 100, mp: 20, mpMax: 20, tp: 0, isDead: false, states: [] }],
    enemies: [{ enemyId: 10, instanceId: 'enemy:0', name: 'Slime', index: 0, hp: 20, hpMax: 20, isDead: false, states: [] }],
    offers: [
      {
        actionKey: 'actor:1:attack',
        actor: { kind: 'actor', id: 1, instance: 'actor:1' },
        kind: 'attack',
        abilityId: 1,
        name: 'Attack',
        targetRule: 'one_enemy',
        costs: { mp: 0, tp: 0 },
        effect: { kind: 'damage' },
      },
      {
        actionKey: 'actor:1:guard',
        actor: { kind: 'actor', id: 1, instance: 'actor:1' },
        kind: 'guard',
        abilityId: 2,
        name: 'Guard',
        targetRule: 'user',
        costs: { mp: 0, tp: 0 },
        effect: { kind: 'guard' },
      },
    ],
    capabilitiesRevision: 1,
    ...overrides,
  }
}

export function runningCoordinator(options: Partial<CoordinatorOptions> = {}) {
  const arbiter = createControlArbiter()
  const coordinator = new CompanionCoordinator({ runtimeInstanceId: 'inst-1', arbiter, ...options })
  const acquire = () => arbiter.acquire({ runtimeInstanceId: 'inst-1', ownerId: 'test', scope: 'battle', allowedActions: ['attack', 'guard', 'skill'], requestedAt: Date.now() })
  coordinator.start(acquire())
  return { coordinator, arbiter, acquire }
}
