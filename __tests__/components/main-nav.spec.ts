import { APP_NAV_ITEMS } from '@/components/AppNav'
import { mainNavIdForTab, OVERLAY_MAIN_TABS, overlayTabFor } from '@/components/game-edit/tabs'
import { MAIN_NAV, mainNavFor } from '@/components/main-nav'

const order = MAIN_NAV.map((item) => item.id)
const isSubsequence = (ids: readonly string[]) => ids.every((id, i) => i === 0 || order.indexOf(id as never) > order.indexOf(ids[i - 1] as never))

describe('main nav', () => {
  it('has one order: 翻译 then 辅助', () => {
    expect(order).toEqual(['library', 'edit', 'translate', 'assist', 'logs', 'integration', 'about'])
  })

  it('surfaces only hide items, never reorder them', () => {
    expect(mainNavFor('web').map((i) => i.id)).toEqual(['library', 'edit', 'translate', 'assist', 'logs', 'integration'])
    expect(mainNavFor('overlay').map((i) => i.id)).toEqual(['edit', 'translate', 'assist', 'logs', 'integration', 'about'])
    expect(isSubsequence(APP_NAV_ITEMS.map((i) => i.id))).toBe(true)
  })

  it('maps overlay pages to modules both ways', () => {
    expect(overlayTabFor('edit', 'bag')).toBe('bag')
    expect(overlayTabFor('assist', 'run')).toBe('settings')
    expect(overlayTabFor('library', 'run')).toBeNull()
    for (const [id, tab] of Object.entries(OVERLAY_MAIN_TABS)) expect(mainNavIdForTab(tab)).toBe(id)
    expect(mainNavIdForTab('actor')).toBe('edit')
  })
})
