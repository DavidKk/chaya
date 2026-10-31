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
    isRepeated?: (key: string) => boolean
    isPressed?: (key: string) => boolean
    __chayaSkipBattleResult?: boolean
  }
  $gameMessage?: { numChoices?: () => number; isChoice?: () => boolean; isNumberInput?: () => boolean; isItemChoice?: () => boolean }
  $gameTemp?: { _chayaBattleResult?: boolean; _chayaBattleResultScene?: object | null }
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
const HOOK_KEY = '__chayaBattleResultHook'
type HookedFunction = { [HOOK_KEY]?: boolean }

const RESULT_SCENE = /victory|battleresult|battle[_]?end|battle[_]?result|aftermath/i

function sceneName(scene: object | null | undefined) {
  if (!scene) return ''
  return String((scene as { constructor?: { name?: string } }).constructor?.name || '')
}

function markBattleResult() {
  const temp = g().$gameTemp
  if (temp) {
    temp._chayaBattleResult = true
    temp._chayaBattleResultScene = g().SceneManager?._scene
  }
}

function clearBattleResultMarkIfIdle() {
  const { SceneManager, Scene_Battle, $gameTemp } = g()
  if (!$gameTemp?._chayaBattleResult) return
  const scene = SceneManager?._scene
  if (scene && RESULT_SCENE.test(sceneName(scene))) return
  if (scene && Scene_Battle && scene instanceof Scene_Battle && scene === $gameTemp._chayaBattleResultScene) return
  $gameTemp._chayaBattleResult = false
  $gameTemp._chayaBattleResultScene = null
}

function ensureBattleManagerHook() {
  const bm = g().BattleManager
  if (!bm) return
  for (const key of ['processVictory', 'processDefeat'] as const) {
    const original = bm[key]
    if (typeof original !== 'function' || (original as HookedFunction)[HOOK_KEY]) continue
    bm[key] = Object.assign(
      function (this: unknown, ...args: unknown[]) {
        markBattleResult()
        return original.apply(this, args)
      },
      { [HOOK_KEY]: true }
    )
  }
}

export function isBattleResultContext() {
  const { BattleManager, SceneManager, Scene_Battle, $gameMessage, $gameTemp } = g()
  if ($gameMessage?.isChoice?.() || ($gameMessage?.numChoices?.() ?? 0) > 0 || $gameMessage?.isNumberInput?.() || $gameMessage?.isItemChoice?.()) return false
  const scene = SceneManager?._scene
  if (scene && RESULT_SCENE.test(sceneName(scene))) return true
  if (!scene || !Scene_Battle || !(scene instanceof Scene_Battle)) return false
  if ($gameTemp?._chayaBattleResult && scene === $gameTemp._chayaBattleResultScene) return true
  if (BattleManager) {
    const phase = String(BattleManager._phase || '')
    if (phase === 'battleEnd' || BattleManager.isBattleEnd?.() || BattleManager.isBattleEnding?.()) return true
  }
  return false
}

function ensureInputHook() {
  const Input = g().Input
  if (!Input) return
  const shouldConfirm = (key: string, held: boolean) => {
    const current = state()
    if (!current.enabled || key !== 'ok' || !isBattleResultContext()) return false
    if (held) return true
    const now = Date.now()
    if (now < current.nextConfirmAt) return false
    current.nextConfirmAt = now + CONFIRM_GAP_MS
    return true
  }
  for (const method of ['isTriggered', 'isRepeated', 'isPressed'] as const) {
    const original = Input[method]
    if (!original || (original as HookedFunction)[HOOK_KEY]) continue
    Input[method] = Object.assign(
      function (this: unknown, key: string) {
        if (shouldConfirm(key, method === 'isPressed')) return true
        return original.call(this, key)
      },
      { [HOOK_KEY]: true }
    )
  }
}

export function getSkipBattleResult() {
  return state().enabled
}

export function setSkipBattleResult(on: boolean) {
  const current = state()
  current.enabled = !!on
  current.nextConfirmAt = 0
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
