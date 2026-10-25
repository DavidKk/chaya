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
    isPressed?: (key: string) => boolean
    __chayaSkipBattleResult?: boolean
  }
  $gameMessage?: { isBusy?: () => boolean; numChoices?: () => number }
  $gameTemp?: { _chayaBattleResult?: boolean }
}

const g = () => globalThis as unknown as BattleGlobals

const STATE_KEY = '__chayaSkipBattleResultState_v1__'
type SkipBattleResultState = {
  enabled: boolean
  /** Earliest time for the next synthetic OK. */
  nextConfirmAt: number
}
const stateHost = globalThis as typeof globalThis & { [STATE_KEY]?: SkipBattleResultState }

function state(): SkipBattleResultState {
  if (!stateHost[STATE_KEY]) stateHost[STATE_KEY] = { enabled: false, nextConfirmAt: 0 }
  return stateHost[STATE_KEY]
}

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
  const origTriggered = Input.isTriggered
  const origPressed = Input.isPressed
  if (!origTriggered) return
  Input.__chayaSkipBattleResult = true
  const shouldConfirm = (key: string) => {
    const current = state()
    if (!current.enabled || key !== 'ok' || !isBattleResultContext()) return false
    const now = Date.now()
    if (now < current.nextConfirmAt) return false
    current.nextConfirmAt = now + CONFIRM_GAP_MS
    return true
  }
  Input.isTriggered = function (key: string) {
    if (shouldConfirm(key)) return true
    return origTriggered.call(this, key)
  }
  if (origPressed) {
    Input.isPressed = function (key: string) {
      if (state().enabled && key === 'ok' && isBattleResultContext()) return true
      return origPressed.call(this, key)
    }
  }
}

export function getSkipBattleResult() {
  return state().enabled
}

export function setSkipBattleResult(on: boolean) {
  const current = state()
  current.enabled = !!on
  current.nextConfirmAt = 0
  const Input = g().Input
  if (Input) Input.__chayaSkipBattleResult = false
  if (current.enabled) {
    ensureInputHook()
    ensureBattleManagerHook()
  }
  return current.enabled
}

/** Tick: keep hooks alive; Input hook performs confirms. */
export function trySkipBattleResult() {
  if (!state().enabled) {
    clearBattleResultMarkIfIdle()
    return
  }
  ensureInputHook()
  ensureBattleManagerHook()
  clearBattleResultMarkIfIdle()
}
