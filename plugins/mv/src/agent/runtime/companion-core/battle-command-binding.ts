import type { ContextStamp } from '@/lib/game-agent/companion/types'

type Binding = { commandId: string; encounterId: string; context: string }
const commands = new WeakMap<object, Binding>()
const context = (stamp: ContextStamp) => JSON.stringify([stamp.scope, stamp.contextEpoch])

// Only the exact Game_Action selected through ordinary input may claim its results.
export function bindBattleCommand(action: object, commandId: string, encounterId: string, stamp: ContextStamp): void {
  commands.set(action, { commandId, encounterId, context: context(stamp) })
}

export function readBattleCommand(action: object, encounterId: string | null, stamp: ContextStamp): string | undefined {
  const binding = commands.get(action)
  return binding?.encounterId === encounterId && binding.context === context(stamp) ? binding.commandId : undefined
}
