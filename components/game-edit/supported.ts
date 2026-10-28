import type { TabId } from './tabs'
import type { RunActionId, RunFlagKey } from './types'

/** RGSS 当前支持的修改子页 */
export const RGSS_SUPPORTED_EDIT_TABS: ReadonlySet<TabId> = new Set<TabId>(['run', 'item', 'weapon', 'armor', 'bag', 'var', 'sw', 'actor'])

/** RGSS 当前支持的运行标记开关 */
export const RGSS_SUPPORTED_RUN_FLAGS: ReadonlySet<RunFlagKey> = new Set<RunFlagKey>([
  'through',
  'encounter',
  'saveEnabled',
  'menuEnabled',
  'clickMove',
  'alwaysDash',
  'autotalk',
  'autoBattle',
  'autoWin',
  'skipBattleResult',
])

/** RGSS 当前支持的瞬时运行动作 */
export const RGSS_SUPPORTED_RUN_ACTIONS: ReadonlySet<RunActionId> = new Set<RunActionId>([
  'battle:victory',
  'battle:escape',
  'battle:defeat',
  'battle:abort',
  'battle:enemyHp1',
  'battle:partyHeal',
  'fix:map',
  'fix:title',
  'fix:clearEvent',
  'fix:clearMoveRoute',
  'fix:closeWindows',
  'fix:fadeIn',
  'scene:item',
  'scene:skill',
  'scene:equip',
  'scene:save',
])

const RUN_ACTIONS_NEED_CLOSE: ReadonlySet<RunActionId> = new Set(['battle:victory', 'battle:escape', 'battle:defeat', 'battle:abort', 'fix:map', 'fix:title'])

/** 场景跳转与战斗结束类动作：玩家需要观察游戏画面，执行后关闭浮层归还焦点 */
export function runActionNeedsClose(id: RunActionId): boolean {
  return id.startsWith('scene:') || RUN_ACTIONS_NEED_CLOSE.has(id)
}
