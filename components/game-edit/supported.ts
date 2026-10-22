import type { TabId } from './tabs'
import type { RunFlagKey } from './types'

/** RGSS 当前支持的修改子页 */
export const RGSS_SUPPORTED_EDIT_TABS: ReadonlySet<TabId> = new Set<TabId>(['run', 'item', 'weapon', 'armor', 'bag', 'var', 'sw', 'actor'])

/** RGSS 当前支持的运行标记开关 */
export const RGSS_SUPPORTED_RUN_FLAGS: ReadonlySet<RunFlagKey> = new Set<RunFlagKey>(['through', 'encounter', 'saveEnabled', 'menuEnabled', 'clickMove'])
