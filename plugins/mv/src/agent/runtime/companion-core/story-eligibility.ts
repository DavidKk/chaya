import { chestEventOpened } from '../../event-facts'
import { isBenchmarkStoryGame } from './story-benchmark'

export function detectStaticLockRequirement(event: any): number | null {
  const list = event?.list?.() ?? event?.event?.()?.pages?.[event?._pageIndex ?? 0]?.list ?? []
  let minimum: number | null = null
  for (const command of list) {
    const parameters = command?.parameters
    if (command?.code !== 122 || !Array.isArray(parameters) || parameters[2] !== 0) continue
    const [first, last, , operand, value] = parameters
    if (typeof value !== 'number' || ![0, 2].includes(operand)) continue
    if ((first <= 2 && last >= 2) || (first <= 5 && last >= 5)) return value
    if (first === 54 && last === 54) minimum = value
  }
  return minimum
}

export function isTrapEvent(event: any): boolean {
  if (!isBenchmarkStoryGame()) return false
  const pages = event?.event?.()?.pages ?? [{ list: event?.list?.() ?? [] }]
  return pages.some((page: any) =>
    page.list?.some((command: any) => command?.code === 122 && command.parameters?.[0] <= 5 && command.parameters?.[1] >= 5 && command.parameters?.[2] === 0)
  )
}

export function hasRewardCommand(event: any): boolean {
  return (event?.list?.() ?? []).some((command: any) => {
    const parameters = command?.parameters
    if (!Array.isArray(parameters)) return false
    if (command.code === 125) return parameters[0] === 0 && (parameters[1] !== 0 || parameters[2] > 0)
    return [126, 127, 128].includes(command.code) && parameters[1] === 0 && (parameters[2] !== 0 || parameters[3] > 0)
  })
}

export function interactionKind(event: any): 'chest' | 'lever' | null {
  if (isTrapEvent(event)) return 'lever'
  if (hasRewardCommand(event)) return 'chest'
  const list = event?.list?.() ?? []
  return list.some((command: any) => [121, 123].includes(command?.code)) ? 'lever' : null
}

export function isCompletedEvent(event: any, mapId: number, eventId: number): boolean {
  if (!isTrapEvent(event)) return chestEventOpened(event, mapId, eventId)
  if (event?._erased) return true
  const list = event?.list?.() ?? []
  return event?._pageIndex > 0 && !list.some((command: any) => command?.code === 102)
}
