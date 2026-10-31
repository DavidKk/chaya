import type { FactView } from '@/lib/game-agent/companion/types'

import { call, g, getBattleScene, type Loose } from './battle-engine'

export function createBattleCapabilitiesRevision(current: () => FactView): () => number {
  let signature = ''
  let revision = 0
  return () => {
    const facts = current()
    const next = JSON.stringify([facts.capabilities, facts.mechanics])
    if (next !== signature) {
      signature = next
      revision++
    }
    return revision
  }
}

/** Negotiate the supported engine contract before ordinary input can be sent. */
export function battleSupportIssue(requireBattle = false): string | null {
  const engine = (g().Utils as Loose | undefined)?.RPGMAKER_NAME
  if (engine !== 'MV' && engine !== 'MZ') return '当前引擎未适配本地战斗'
  const manager = g().BattleManager as Loose | undefined
  if (!manager || !['actor', 'isInputting', 'inputtingAction', 'endBattle'].every((name) => typeof manager[name] === 'function')) {
    return '战斗引擎缺少必要的观察或结算接口'
  }
  if (call<boolean>(manager, 'isTpb') === true || ((g().$dataSystem as Loose | undefined)?.battleSystem ?? 0) !== 0) {
    return 'TPB 或自定义战斗模式尚未适配'
  }
  const scene = getBattleScene()
  if (requireBattle && !scene) return '请先进入标准回合战斗，再让我接手'
  if (
    scene &&
    !['_partyCommandWindow', '_actorCommandWindow', '_skillWindow', '_enemyWindow', '_actorWindow'].every((name) => {
      const window = scene[name] as Loose | undefined
      return window && typeof window.index === 'function' && typeof window.maxCols === 'function'
    })
  )
    return '当前战斗窗口不符合已适配的标准命令接口'
  return null
}
