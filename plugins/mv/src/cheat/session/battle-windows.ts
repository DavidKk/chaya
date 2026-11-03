/**
 * Battle scene command sub-windows (target / skill / item pickers), shared by battle edits and auto win.
 */
type InputWindow = { active?: boolean; visible?: boolean; deactivate?: () => void; hide?: () => void; refresh?: () => void }
type CommandWindow = {
  active?: boolean
  visible?: boolean
  deactivate?: () => void
  activate?: () => void
  close?: () => void
  open?: () => void
  show?: () => void
  hide?: () => void
  setup?: (actor?: unknown) => void
}
type BattleScene = {
  _enemyWindow?: InputWindow
  _actorWindow?: InputWindow
  _skillWindow?: InputWindow
  _itemWindow?: InputWindow
  _helpWindow?: InputWindow
  _partyCommandWindow?: CommandWindow
  _actorCommandWindow?: CommandWindow
  startActorCommandSelection?: () => void
  startPartyCommandSelection?: () => void
}

const g = () =>
  globalThis as unknown as {
    SceneManager?: { _scene?: unknown }
    Scene_Battle?: new () => unknown
    BattleManager?: {
      _phase?: string
      isInputting?: () => boolean
      actor?: () => { canInput?: () => boolean; setActionState?: (state: string) => void } | null
    }
    $gameTemp?: { _bcom_need_refresh?: boolean }
    $gameMessage?: { isBusy?: () => boolean }
    $gameTroop?: { isEventRunning?: () => boolean }
  }

export function battleScene<T extends object = BattleScene>(): (T & BattleScene) | null {
  const { SceneManager, Scene_Battle } = g()
  const scene = SceneManager?._scene
  return scene && Scene_Battle && scene instanceof Scene_Battle ? (scene as T & BattleScene) : null
}

/** MV leaves open pickers drawn over the victory / defeat message, so close them before ending the battle */
export function closeBattleInputWindows(): void {
  const scene = battleScene()
  for (const w of [scene?._enemyWindow, scene?._actorWindow, scene?._skillWindow, scene?._itemWindow, scene?._helpWindow]) {
    if (!w || (!w.active && w.visible !== true)) continue
    w.deactivate?.()
    w.hide?.()
  }
}

/** An open enemy target list keeps listing the old names / fallen enemies until refreshed */
export function refreshEnemyWindow(): void {
  const targets = battleScene()?._enemyWindow
  if (targets?.active) targets.refresh?.()
}

/**
 * When auto-battle is cancelled / toggled off, restore command windows:
 * ensures visibility is restored and re-opens the active command selection (or MOG command cubes)
 * if currently in the battle input phase.
 */
export function restoreBattleInputWindows(): void {
  const scene = battleScene()
  if (!scene) return
  const { BattleManager, $gameTemp, $gameMessage, $gameTroop } = g()
  const isInputting = typeof BattleManager?.isInputting === 'function' ? BattleManager.isInputting() : BattleManager?._phase === 'input'
  if (!isInputting || $gameMessage?.isBusy?.() || $gameTroop?.isEventRunning?.()) return

  const currentActor = BattleManager?.actor?.()
  if (currentActor?.canInput && !currentActor.canInput()) return

  const partyWin = scene._partyCommandWindow
  const actorWin = scene._actorCommandWindow

  // Keep an untouched manual picker when automation was cancelled before it submitted.
  if ([scene._enemyWindow, scene._actorWindow, scene._skillWindow, scene._itemWindow, partyWin, actorWin].some((w) => w?.active && w.visible !== false)) return
  closeBattleInputWindows()
  partyWin?.show?.()
  actorWin?.show?.()
  if (partyWin) partyWin.visible = true
  if (actorWin) actorWin.visible = true

  if ($gameTemp && typeof $gameTemp._bcom_need_refresh !== 'undefined') {
    $gameTemp._bcom_need_refresh = true
  }
  if (currentActor) {
    partyWin?.deactivate?.()
    partyWin?.close?.()
    currentActor.setActionState?.('inputting')
    if (typeof scene.startActorCommandSelection === 'function') {
      // MOG rebuilds its command sprites inside setup; do not initialize them twice.
      scene.startActorCommandSelection()
    } else {
      actorWin?.setup?.(currentActor)
      actorWin?.open?.()
      actorWin?.activate?.()
    }
  } else {
    actorWin?.deactivate?.()
    actorWin?.close?.()
    if (typeof scene.startPartyCommandSelection === 'function') scene.startPartyCommandSelection()
    else {
      partyWin?.setup?.()
      partyWin?.open?.()
      partyWin?.activate?.()
    }
  }
}
