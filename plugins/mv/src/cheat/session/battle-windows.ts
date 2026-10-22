/**
 * Battle scene command sub-windows (target / skill / item pickers), shared by battle edits and auto win.
 */
type InputWindow = { active?: boolean; deactivate?: () => void; hide?: () => void; refresh?: () => void }
type BattleScene = {
  _enemyWindow?: InputWindow
  _actorWindow?: InputWindow
  _skillWindow?: InputWindow
  _itemWindow?: InputWindow
}

const g = () =>
  globalThis as unknown as {
    SceneManager?: { _scene?: unknown }
    Scene_Battle?: new () => unknown
  }

export function battleScene<T extends object = BattleScene>(): (T & BattleScene) | null {
  const { SceneManager, Scene_Battle } = g()
  const scene = SceneManager?._scene
  return scene && Scene_Battle && scene instanceof Scene_Battle ? (scene as T & BattleScene) : null
}

/** MV leaves open pickers drawn over the victory / defeat message, so close them before ending the battle */
export function closeBattleInputWindows(): void {
  const scene = battleScene()
  for (const w of [scene?._enemyWindow, scene?._actorWindow, scene?._skillWindow, scene?._itemWindow]) {
    if (!w?.active) continue
    w.deactivate?.()
    w.hide?.()
  }
}

/** An open enemy target list keeps listing the old names / fallen enemies until refreshed */
export function refreshEnemyWindow(): void {
  const targets = battleScene()?._enemyWindow
  if (targets?.active) targets.refresh?.()
}
