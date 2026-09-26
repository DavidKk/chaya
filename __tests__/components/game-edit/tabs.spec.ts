import { describe, expect, it } from '@jest/globals'

import {
  DEFAULT_TAB,
  EDIT_TABS,
  editActorHref,
  editTabHref,
  isEditTab,
  isTabId,
  parseActorIdSegment,
  parseActorPaneSegment,
  parseTabId,
  TABS,
  tabsForSurface,
} from '@/components/game-edit/tabs'

describe('game-edit tabs / cheat 路径', () => {
  it('默认 tab 为 run，且 TABS 非空', () => {
    expect(DEFAULT_TAB).toBe('run')
    expect(TABS.length).toBeGreaterThan(5)
    expect(TABS.every((t) => isTabId(t.id))).toBe(true)
  })

  it('parseTabId 回退', () => {
    expect(parseTabId('bag')).toBe('bag')
    expect(parseTabId('nope')).toBe(DEFAULT_TAB)
  })

  it('editTabHref', () => {
    expect(editTabHref('run')).toBe('/cheat/run')
    expect(editTabHref('actor')).toBe('/cheat/actor')
  })

  it('editActorHref 四级路径', () => {
    expect(editActorHref(null)).toBe('/cheat/actor')
    expect(editActorHref(12)).toBe('/cheat/actor/12')
    expect(editActorHref(12, 'states')).toBe('/cheat/actor/12/states')
    expect(editActorHref(12, 'skills')).toBe('/cheat/actor/12/skills')
    expect(editActorHref(12, 'actor')).toBe('/cheat/actor/12')
  })

  it('parseActor 段', () => {
    expect(parseActorIdSegment('12')).toBe(12)
    expect(parseActorIdSegment('0')).toBeNull()
    expect(parseActorIdSegment('ab')).toBeNull()
    expect(parseActorPaneSegment(undefined)).toBe('actor')
    expect(parseActorPaneSegment('states')).toBe('states')
    expect(parseActorPaneSegment('nope')).toBeNull()
  })

  it('两个表面共用修改分类，翻译与日志只出现在一级导航', () => {
    expect(tabsForSurface('page')).toEqual(EDIT_TABS)
    expect(tabsForSurface('overlay')).toEqual(EDIT_TABS)
    expect(EDIT_TABS.map((t) => t.id)).not.toContain('trans')
    expect(EDIT_TABS.map((t) => t.id)).not.toContain('logs')
    expect(isEditTab('actor')).toBe(true)
    expect(isEditTab('trans')).toBe(false)
    expect(isEditTab('logs')).toBe(false)
  })
})
