type ParamBattler = {
  paramBase?: (paramId: number) => number
  paramPlus?: (paramId: number) => number
  addParam?: (paramId: number, value: number) => void
  param?: (paramId: number) => number
  paramMax?: (paramId: number) => number
}

/** Stands in for MZ's uncapped (`Infinity`) params so the page's number fields stay bounded */
const UNCAPPED = 9_999_999

/** `paramMax(paramId)`; `fallback` (the MV value) when the battler has none */
export function paramCap(battler: ParamBattler, paramId: 0 | 1, fallback: number): number {
  const cap = typeof battler.paramMax === 'function' ? Number(battler.paramMax(paramId)) : fallback
  if (cap === Infinity) return UNCAPPED
  return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : fallback
}

/**
 * Sets a final param (0 = max HP, 1 = max MP) through the additive bonus, scaled by the current
 * `param / (base + plus)` so rates and buffs are kept and `refresh` does not undo it.
 */
export function writeMaxParam(battler: ParamBattler, paramId: 0 | 1, value: number): void {
  if (typeof battler.addParam !== 'function' || typeof battler.paramBase !== 'function' || typeof battler.paramPlus !== 'function' || typeof battler.param !== 'function') {
    throw new Error('游戏未就绪')
  }
  if (!Number.isFinite(value)) throw new Error('数值无效')
  const target = Math.max(paramId === 0 ? 1 : 0, Math.floor(value))
  const raw = battler.paramBase(paramId) + battler.paramPlus(paramId)
  const current = battler.param(paramId)
  const factor = raw > 0 && current > 0 ? current / raw : 1
  battler.addParam(paramId, Math.round(target / factor) - raw)
}
