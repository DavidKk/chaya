import type { MilestoneGameEvent } from '@/lib/game-agent/companion/types'

import { hookMethod } from '../../helpers/game/method-hook'
import { generateUuid } from './companion-facts-helpers'
import { call } from './companion-facts-mechanics'

type Loose = Record<string, unknown>

/** Aggregate the standard reward transaction; observe level changes outside battle too. */
export function installCompanionMilestones(emit: (event: MilestoneGameEvent) => void): () => void {
  const world = globalThis as unknown as Loose
  const unhooks: Array<() => void> = []
  let rewardsDepth = 0
  const levels = () =>
    (call<Loose[]>(world.$gameParty, 'allMembers') ?? []).slice(0, 16).map((actor) => ({
      actorId: call<number>(actor, 'actorId'),
      level: typeof actor.level === 'number' ? actor.level : null,
    }))
  const notify = (name: string, details: Record<string, unknown>) => {
    try {
      emit({ kind: 'milestone', milestoneId: generateUuid('milestone'), name, details, at: Date.now() })
    } catch {
      // Observation must never prevent the engine from applying rewards.
    }
  }
  const battle = world.BattleManager as Loose | undefined
  if (battle) {
    unhooks.push(
      hookMethod(
        battle,
        'gainRewards',
        (original) =>
          function (this: Loose, ...args: unknown[]) {
            const beforeGold = call<number>(world.$gameParty, 'gold')
            const beforeLevels = levels()
            const rewards = this._rewards as Loose | undefined
            const items = (Array.isArray(rewards?.items) ? rewards.items : []).slice(0, 32) as Loose[]
            const inventory = items.map((item) => ({ item, before: call<number>(world.$gameParty, 'numItems', item) }))
            rewardsDepth += 1
            try {
              const result = original.apply(this, args)
              const afterGold = call<number>(world.$gameParty, 'gold')
              const afterLevels = levels()
              notify('battle_reward', {
                gold: typeof beforeGold === 'number' && typeof afterGold === 'number' ? afterGold - beforeGold : null,
                items: inventory
                  .map(({ item, before }) => {
                    const after = call<number>(world.$gameParty, 'numItems', item)
                    return {
                      id: typeof item.id === 'number' ? item.id : null,
                      name: typeof item.name === 'string' ? item.name.slice(0, 100) : '',
                      amount: typeof before === 'number' && typeof after === 'number' ? after - before : null,
                    }
                  })
                  .filter((item, index, list) => list.findIndex((other) => other.id === item.id && other.name === item.name) === index),
                levels: afterLevels.filter((actor) => {
                  const before = beforeLevels.find((previous) => previous.actorId === actor.actorId)
                  return before && before.level !== null && actor.level !== null && actor.level > before.level
                }),
              })
              return result
            } finally {
              rewardsDepth -= 1
            }
          }
      )
    )
  }
  const actorPrototype = (world.Game_Actor as Loose | undefined)?.prototype as Loose | undefined
  if (actorPrototype) {
    unhooks.push(
      hookMethod(
        actorPrototype,
        'changeExp',
        (original) =>
          function (this: Loose, ...args: unknown[]) {
            const before = this.level
            const result = original.apply(this, args)
            const after = this.level
            if (rewardsDepth === 0 && typeof before === 'number' && typeof after === 'number' && after > before) {
              notify('level_up', { actorId: call<number>(this, 'actorId') ?? null, fromLevel: before, toLevel: after })
            }
            return result
          }
      )
    )
  }
  return () => {
    for (const undo of unhooks) undo()
  }
}
