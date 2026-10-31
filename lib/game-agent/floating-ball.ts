import { RUN_ACTION_IDS, RUN_FLAG_KEYS, type RunActionId, type RunFlagKey } from '@/components/game-edit/types'

export type FloatingShortcutId = `flag:${RunFlagKey}` | `action:${RunActionId}`
export type FloatingShortcut = { kind: 'flag'; target: RunFlagKey } | { kind: 'action'; target: RunActionId }

export const MAX_FLOATING_SHORTCUTS = 8
export const DEFAULT_FLOATING_SHORTCUTS: FloatingShortcutId[] = ['action:battle:victory', 'action:scene:item', 'flag:autoBattle', 'flag:autoWin', 'flag:autotalk']

export function parseFloatingShortcut(value: unknown): FloatingShortcut | null {
  if (typeof value !== 'string') return null
  if (value.startsWith('flag:') && (RUN_FLAG_KEYS as readonly string[]).includes(value.slice(5))) return { kind: 'flag', target: value.slice(5) as RunFlagKey }
  if (value.startsWith('action:') && (RUN_ACTION_IDS as readonly string[]).includes(value.slice(7))) return { kind: 'action', target: value.slice(7) as RunActionId }
  return null
}

export function normalizeFloatingShortcuts(value: unknown): FloatingShortcutId[] {
  if (!Array.isArray(value)) return [...DEFAULT_FLOATING_SHORTCUTS]
  return [...new Set(value.filter((id): id is FloatingShortcutId => parseFloatingShortcut(id) !== null))].slice(0, MAX_FLOATING_SHORTCUTS)
}

/** Party recovery is useful on the map too; the other battle commands require a battle. */
export function floatingShortcutNeedsBattle(id: RunActionId): boolean {
  return id.startsWith('battle:') && !['battle:partyHeal', 'battle:partyHp1', 'battle:partyHp0'].includes(id)
}
