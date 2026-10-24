/**
 * Rapidly confirm battle result UI — mash OK only, do not skip rewards/phases.
 */

type BattleGlobals = {
  BattleManager?: {
    _phase?: string
    isBattleEnd?: () => boolean
    isBattleEnding?: () => boolean
    processVictory?: (...args: unknown[]) => unknown
    processDefeat?: (...args: unknown[]) => unknown
    __chayaSkipBattleResult?: boolean
  }
  SceneManager?: { _scene?: object | null }
  Scene_Battle?: new () => object
  Input?: {
    isTriggered?: (key: string) => boolean
    __chayaSkipBattleResult?: boolean
  }
  $gameMessage?: { isBusy?: () => boolean; numChoices?: () => number }
  $gameTemp?: { _chayaBattleResult?: boolean }
}

const g = () => globalThis as unknown as BattleGlobals

let skipBattleResult = false
/** Earliest time for the next synthetic OK. */
let nextConfirmAt = 0
const CONFIRM_GAP_MS = 100

const RESULT_SCENE = /victory|battleresult|battle[_]?end|battle[_]?result|aftermath/i

function sceneName(scene: object | null | undefined) {
  if (!scene) return ''
  return String((scene as { constructor?: { name?: string } }).constructor?.name || '')
}

function markBattleResult() {
  const temp = g().$gameTemp
  if (temp) temp._chayaBattleResult = true
}

function clearBattleResultMarkIfIdle() {
  const { SceneManager, Scene_Battle, $gameMessage, $gameTemp } = g()
  if (!$gameTemp?._chayaBattleResult) return
  if ($gameMessage?.isBusy?.()) return
  const scene = SceneManager?._scene
  if (scene && RESULT_SCENE.test(sceneName(scene))) return
  if (scene && Scene_Battle && scene instanceof Scene_Battle) return
  $gameTemp._chayaBattleResult = false
}

function ensureBattleManagerHook() {
  const bm = g().BattleManager
  if (!bm || bm.__chayaSkipBattleResult) return
  bm.__chayaSkipBattleResult = true
  for (const key of ['processVictory', 'processDefeat'] as const) {
    const original = bm[key]
    if (typeof original !== 'function') continue
    bm[key] = function (this: unknown, ...args: unknown[]) {
      markBattleResult()
      return original.apply(this, args)
    }
  }
}

export function isBattleResultContext() {
  const { BattleManager, SceneManager, Scene_Battle, $gameMessage, $gameTemp } = g()
  if ($gameTemp?._chayaBattleResult) return true
  const scene = SceneManager?._scene
  if (scene && RESULT_SCENE.test(sceneName(scene))) return true
  if (BattleManager) {
    const phase = String(BattleManager._phase || '')
    if (phase === 'battleEnd' || BattleManager.isBattleEnd?.() || BattleManager.isBattleEnding?.()) return true
  }
  if (scene && Scene_Battle && scene instanceof Scene_Battle && $gameMessage?.isBusy?.() && (!$gameMessage.numChoices || $gameMessage.numChoices() === 0)) {
    return true
  }
  return false
}

function ensureInputHook() {
  const Input = g().Input
  if (!Input || Input.__chayaSkipBattleResult) return
  Input.__chayaSkipBattleResult = true
  const origTriggered = Input.isTriggered?.bind(Input)
  if (!origTriggered) return
  Input.isTriggered = function (key: string) {
    if (skipBattleResult && key === 'ok' && isBattleResultContext()) {
      const now = Date.now()
      if (now >= nextConfirmAt) {
        nextConfirmAt = now + CONFIRM_GAP_MS
        return true
      }
    }
    return origTriggered(key)
  }
}

export function getSkipBattleResult() {
  return skipBattleResult
}

export function setSkipBattleResult(on: boolean) {
  skipBattleResult = !!on
  if (skipBattleResult) {
    ensureInputHook()
    ensureBattleManagerHook()
  }
  return skipBattleResult
}

/** Tick: keep hooks alive; Input hook performs confirms. */
export function trySkipBattleResult() {
  if (!skipBattleResult) {
    clearBattleResultMarkIfIdle()
    return
  }
  ensureInputHook()
  ensureBattleManagerHook()
  clearBattleResultMarkIfIdle()
}
