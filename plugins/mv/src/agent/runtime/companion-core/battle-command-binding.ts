import type { ActionIntent } from '@/lib/game-agent/companion/core/types'
import type { ContextStamp } from '@/lib/game-agent/companion/types'

type ActionSignature = { abilityId?: number; item?: boolean; targetIndex?: number }
type Binding = { commandId: string; encounterId: string; context: string; signature: ActionSignature }
const commands = new WeakMap<object, Binding>()
const context = (stamp: ContextStamp) => JSON.stringify([stamp.scope, stamp.contextEpoch])

function signature(action: object): ActionSignature {
  const value = action as { item?(): { id?: number } | null; isItem?(): boolean; _targetIndex?: number }
  return { abilityId: value.item?.()?.id, item: value.isItem?.(), targetIndex: value._targetIndex }
}

// Only the exact Game_Action selected through ordinary input may claim its results.
export function bindBattleCommand(action: object, commandId: string, encounterId: string, stamp: ContextStamp, intent?: ActionIntent): void {
  // Final input may still set the skill or target. Compare against its authorized
  // destination, rather than the action's intermediate menu state.
  const expected = intent
    ? {
        abilityId: intent.actionOffer.abilityId,
        item: intent.actionOffer.kind === 'item',
        targetIndex: ['enemy', 'actor'].includes(intent.target.kind) ? intent.target.targetIndex : undefined,
      }
    : signature(action)
  commands.set(action, { commandId, encounterId, context: context(stamp), signature: expected })
}

export function readBattleCommand(action: object, encounterId: string | null, stamp: ContextStamp): string | undefined {
  const binding = commands.get(action)
  if (!binding || binding.encounterId !== encounterId || binding.context !== context(stamp)) return undefined
  const actual = signature(action)
  if (Object.entries(binding.signature).some(([key, value]) => value !== undefined && actual[key as keyof ActionSignature] !== value)) {
    commands.delete(action)
    return undefined
  }
  return binding.commandId
}
