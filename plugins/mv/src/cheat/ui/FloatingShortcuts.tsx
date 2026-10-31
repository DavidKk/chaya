import { emptySession, type SessionState } from '@/components/game-edit/types'
import { FloatingBall, type FloatingBallRuntime, type FloatingBallSnapshot } from '@/components/game-tools/FloatingBall'
import { floatingShortcutDisabledReason } from '@/components/game-tools/FloatingBall'
import { useT } from '@/components/i18n/LocaleProvider'
import { parseFloatingShortcut } from '@/lib/game-agent/floating-ball'
import type { ToolSettings } from '@/lib/game-agent/tool-settings'

import { restoreGameFocus } from '../../helpers'
import { applyRunAction, applyRunFlag, runActionNeedsClose } from '../runtime/apply-run'
import { readRunFields } from '../session/live-session'
import { ensureGameEditDiskApplied, scheduleSaveRunFlag } from '../session/persist'

export function FloatingShortcuts({ settings, onRunFields, onClose }: { settings: ToolSettings; onRunFields: (fields: Partial<SessionState>) => void; onClose: () => void }) {
  const t = useT()
  const read = (): FloatingBallSnapshot => {
    const ready = typeof $gameParty !== 'undefined' && !!$gameParty && typeof $gameMap !== 'undefined' && !!$gameMap?.mapId()
    if (!ready) return { ready: false, inBattle: false, flags: {} }
    ensureGameEditDiskApplied()
    return { ready, inBattle: !!$gameParty.inBattle(), flags: readRunFields(emptySession()) }
  }
  const runtime: FloatingBallRuntime = {
    read,
    restoreFocus: restoreGameFocus,
    execute(id) {
      const current = read()
      const reason = floatingShortcutDisabledReason(id, current)
      if (reason) throw new Error(t(reason))
      const shortcut = parseFloatingShortcut(id)
      if (!shortcut) return
      if (shortcut.kind === 'flag') {
        applyRunFlag(shortcut.target, !current.flags[shortcut.target])
        const fields = readRunFields(emptySession())
        scheduleSaveRunFlag(shortcut.target, fields[shortcut.target])
        onRunFields({ [shortcut.target]: fields[shortcut.target] })
      } else {
        if (runActionNeedsClose(shortcut.target)) onClose()
        applyRunAction(shortcut.target)
      }
    },
  }
  if (!settings.floatingBallEnabled) return null
  return <FloatingBall shortcuts={settings.floatingBallShortcuts} runtime={runtime} />
}
