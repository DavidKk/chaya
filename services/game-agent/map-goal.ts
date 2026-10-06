import type { AgentInputKey } from '@/lib/runtime/agent-protocol'

export type MapEvent = {
  id?: number
  name?: string
  hint?: string | null
  x?: number | null
  y?: number | null
  distance?: number | null
  trigger?: string | null
  running?: boolean
}
type Player = { x?: number | null; y?: number | null; direction?: number | null }

export const MAP_SKILLS = {
  approach: 'walk until adjacent to the event without triggering it',
  interact:
    'trigger the event the way the game expects: walk next to it and press ok, or step onto it for touch events. Talking, opening a chest, examining, picking up, entering a door/house/exit and using all mean interact',
} as const
export type MapSkill = keyof typeof MAP_SKILLS
export const MAP_SKILL_NAMES = Object.keys(MAP_SKILLS) as MapSkill[]

export function mapSkillPrompt() {
  return MAP_SKILL_NAMES.map((name) => `${name}: ${MAP_SKILLS[name]}`).join('; ')
}

/** Touch events fire by stepping onto (or bumping into) them; ok does nothing. */
export function isTouchEvent(event: MapEvent | undefined) {
  return event?.trigger === 'player_touch' || event?.trigger === 'event_touch'
}

/** Tiles beside the target, nearest to the player first. */
export function adjacentTiles(player: Player | null | undefined, target: MapEvent | undefined) {
  if (player?.x == null || player.y == null || target?.x == null || target.y == null) return []
  const { x, y } = target
  return [
    { x, y: y + 1 },
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
  ].sort((a, b) => Math.abs(a.x - player.x!) + Math.abs(a.y - player.y!) - (Math.abs(b.x - player.x!) + Math.abs(b.y - player.y!)))
}

/** Key for an adjacent target: turn toward it, then ok; touch events are bumped with the direction key instead. */
export function nextMapTargetKey(player: Player | null | undefined, target: MapEvent | undefined): AgentInputKey | null {
  if (player?.x == null || player.y == null || target?.x == null || target.y == null) return null
  const dx = target.x - player.x
  const dy = target.y - player.y
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null
  const key: AgentInputKey = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down'
  const direction = { down: 2, left: 4, right: 6, up: 8 }[key]
  return !isTouchEvent(target) && player.direction === direction ? 'ok' : key
}
