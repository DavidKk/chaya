import { readAgentGameState } from '../../handlers'
import { StoryContextStore } from './story-context'
import { interactionKind } from './story-eligibility'
import type { ExplorationTarget } from './story-exploration'
import type { StoryPuzzleSolver } from './story-puzzle-solver'
import { isStoryMapExit } from './story-transfer'

export async function resolveStoryPuzzleTarget(
  solver: StoryPuzzleSolver,
  isEligible: (mapId: number, eventId: number) => boolean,
  mapId: number,
  playerPos: { x: number; y: number },
  recentDialogue: string[],
  playerGuidance?: string | null,
  signal?: AbortSignal
): Promise<ExplorationTarget | null> {
  const engine = globalThis as any
  const map = engine.$gameMap
  if (!map?.events) return null
  const nearbyMap = new Map((readAgentGameState().nearbyEvents ?? []).map((event: any) => [event.id, event]))
  const visibleEvents: Array<{ id: number; name: string; x: number; y: number; kind: string; reachable: boolean; preview?: string }> = []
  for (const event of map.events()) {
    const eventId = event?.eventId?.() ?? event?._eventId
    if (!eventId || !isEligible(mapId, eventId)) continue
    const x = Number(event._x)
    const y = Number(event._y)
    const distance = Math.abs(x - playerPos.x) + Math.abs(y - playerPos.y)
    const nearby = nearbyMap.get(eventId)
    if (nearby?.routeStatus === 'terrain_blocked') continue

    const list = (typeof event.list === 'function' ? event.list() : []) || []
    const codes = list.map((c: any) => c?.code).filter((c: any) => typeof c === 'number' && c !== 0)
    if (codes.length === 0) continue

    const eventData = typeof event.event === 'function' ? event.event() : null
    const rawName = eventData?.name || `Event ${eventId}`

    // Detect shop
    const hasShopCommand = codes.includes(302)
    const isShopName = /(магазин|лавка|северин|severin|shop|торговец|купец|зелья|магазинчик)/i.test(rawName)
    const isShop = hasShopCommand || isShopName

    // Extract text preview (Code 401 Show Text line)
    const textSnippets: string[] = []
    for (const cmd of list) {
      if (cmd?.code === 401 && typeof cmd.parameters?.[0] === 'string' && cmd.parameters[0].trim()) {
        const text = cmd.parameters[0].replace(/<[^>]+>/g, '').trim()
        if (text && !textSnippets.includes(text)) textSnippets.push(text)
        if (textSnippets.length >= 2) break
      }
    }
    const preview = textSnippets.length ? textSnippets.join(' / ') : undefined

    const isExit = isStoryMapExit(event, mapId)
    const kind = isExit ? 'transfer' : isShop ? 'shop' : (interactionKind(event) ?? (codes.includes(101) || codes.includes(102) ? 'npc' : 'other'))
    visibleEvents.push({
      id: eventId,
      name: rawName,
      x,
      y,
      kind,
      reachable: nearby ? ['reachable', 'already_there'].includes(nearby.routeStatus) : distance <= 25,
      preview,
    })
  }
  if (!visibleEvents.length) return null
  const diagnosis = await solver.diagnoseNextStep(
    {
      mapId,
      mapName: engine.$dataMapInfos?.[mapId]?.name || `Map ${mapId}`,
      playerPos,
      recentDialogue,
      inventorySummary: (engine.$gameParty?.items?.() ?? []).map((item: any) => item.name).filter(Boolean),
      visibleEvents,
      questContextSummary: StoryContextStore.formatSummaryForPrompt(mapId),
      playerGuidance,
    },
    signal
  )
  signal?.throwIfAborted()
  const event = visibleEvents.find((candidate) => candidate.id === diagnosis.targetEventId)
  if (!event || engine.$gameMap !== map || map.mapId?.() !== mapId || !isEligible(mapId, event.id)) return null
  return {
    eventId: event.id,
    x: event.x,
    y: event.y,
    kind: event.kind === 'transfer' ? 'transfer' : 'guide',
    name: event.name,
    priority: 95,
    hint: diagnosis.hint || `根据线索调查 ${event.name}`,
  }
}
