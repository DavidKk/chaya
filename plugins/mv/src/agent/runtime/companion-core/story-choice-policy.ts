import { StoryContextStore } from './story-context'
import { storyTransferAllowed, storyTravelPolicy } from './story-guidance'
import { isCrossMapTransfer, type StoryTransfer, storyTransfers, storyTravelDirection } from './story-transfer'

function isBacktrackTransfer(mapId: number, eventId: number, transfer?: StoryTransfer): boolean {
  return StoryContextStore.isBacktrackPortal(mapId, eventId, transfer?.mapId ?? undefined)
}

function travelBlocked(policy: ReturnType<typeof storyTravelPolicy>, text: string, mapId: number, eventId: number, destinations: StoryTransfer[]): boolean {
  if (destinations.length > 0) {
    return destinations.some((transfer) => !storyTransferAllowed(policy, text, isBacktrackTransfer(mapId, eventId, transfer)))
  }
  return !storyTransferAllowed(policy, text, isBacktrackTransfer(mapId, eventId))
}

export function allowedStoryChoices(choices: string[], mapId: number, eventId: number, guidance?: string | null, source?: { commands: any[]; index: number } | null): Set<number> {
  const engine = globalThis as any
  const policy = storyTravelPolicy(guidance)
  const event = engine.$gameMap?.event?.(eventId)
  const commands = source?.commands ?? event?.list?.() ?? []
  const menus = commands.flatMap((command: any, index: number) => (command?.code === 102 && JSON.stringify(command.parameters?.[0]) === JSON.stringify(choices) ? [index] : []))
  const menuIndex = source ? menus.filter((index: number) => index <= source.index).at(-1) : menus.length === 1 ? menus[0] : undefined
  const transfers = storyTransfers(event, commands).filter((transfer) => isCrossMapTransfer(transfer, mapId))
  const question = engine.$gameMessage?.allText?.() ?? ''
  const allowed = new Set<number>()
  for (const [index, label] of choices.entries()) {
    const direction = storyTravelDirection(label)
    if ((direction === 'up' && policy.forbidUp) || (direction === 'down' && policy.forbidDown)) continue
    const exits = transfers.filter((transfer) => {
      if (menuIndex === undefined) return false
      const branch = transfer.choices.find((choice) => choice.commands === commands && choice.commandIndex === menuIndex)
      return branch ? branch.index === index : transfer.path.some((step) => step.commands === commands && step.index > menuIndex)
    })
    const yesToTravel =
      /^(是|好|确认|yes|ok|да)[。.!！]?$/i.test(label.trim()) && (storyTravelDirection(question) !== null || /离开|传送|切图|楼梯|portal|teleport|leave|stairs/i.test(question))
    const travelText = direction ? label : storyTravelDirection(question) ? question : event?.event?.()?.name || question
    const destinations = exits.length > 0 ? exits : transfers
    if (exits.some((transfer) => !storyTransferAllowed(policy, travelText, isBacktrackTransfer(mapId, eventId, transfer)))) continue
    if (yesToTravel && travelBlocked(policy, question, mapId, eventId, destinations)) continue
    if (direction && travelBlocked(policy, label, mapId, eventId, destinations)) continue
    allowed.add(index)
  }
  return allowed
}
