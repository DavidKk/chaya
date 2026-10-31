import { RUN_HOTKEY_TARGETS } from '@/components/game-edit/run-hotkeys'
import type { FloatingShortcutId } from '@/lib/game-agent/floating-ball'

export const FLOATING_SHORTCUT_TARGETS = RUN_HOTKEY_TARGETS.filter((target) => target.kind === 'flag' || target.kind === 'action')
export const FLOATING_SHORTCUT_LABELS = new Map(FLOATING_SHORTCUT_TARGETS.map((target) => [target.id as FloatingShortcutId, target]))
