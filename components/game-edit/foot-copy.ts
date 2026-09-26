import type { MessageKey } from '@/lib/i18n'

import type { GameEditSurface, TabId } from './tabs'

export function footPrimaryKey(surface: GameEditSurface, tab: TabId, linked?: boolean): MessageKey {
  if (surface === 'overlay') {
    if (tab === 'run') return 'edit.footOverlayRun'
    if (tab === 'hotkeys') return 'edit.footOverlayHotkeys'
    if (tab === 'trans') return 'edit.footOverlayTrans'
    if (tab === 'logs') return 'edit.footOverlayLogs'
    return 'edit.footOverlayEdit'
  }
  if (linked) {
    if (tab === 'run') return 'edit.footLinkedRun'
    if (tab === 'hotkeys') return 'edit.footLinkedHotkeys'
    if (tab === 'trans') return 'edit.footLinkedTrans'
    return 'edit.footLinkedEdit'
  }
  if (tab === 'run') return 'edit.footPreviewRun'
  if (tab === 'hotkeys') return 'edit.footPreviewHotkeys'
  if (tab === 'trans') return 'edit.footPreviewTrans'
  return 'edit.footPreviewEdit'
}
