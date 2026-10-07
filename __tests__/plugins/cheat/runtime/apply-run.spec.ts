/**
 * @jest-environment jsdom
 */
import type { RunActionId, RunFlagKey } from '@/components/game-edit/types'

const setGod = jest.fn((on: boolean) => on)
const setThrough = jest.fn((on: boolean) => on)
const setAutoWin = jest.fn((on: boolean) => on)
const clearInterpreter = jest.fn()
const battleVictory = jest.fn()
const battleEscape = jest.fn()
const battleDefeat = jest.fn()
const battleAbort = jest.fn()
const healParty = jest.fn()

const ensureHooks = jest.fn()
const setEncounter = jest.fn()
const setMenuEnabled = jest.fn()
const setSaveEnabled = jest.fn()
const setClickMove = jest.fn()
const setFollowersVisible = jest.fn()
const setClickTeleport = jest.fn()
const setResourceSkip = jest.fn()
const setFullscreen = jest.fn()
const popScene = jest.fn()
const pushScene = jest.fn()
const clearPictures = jest.fn()
const clearOverlay = jest.fn()
const clearMoveRoute = jest.fn()
const closeAllWindows = jest.fn()
const gotoTitle = jest.fn()
const gotoMap = jest.fn()
const fadeIn = jest.fn()
const resumeAfterError = jest.fn()
const setEnemyHp = jest.fn()
const setPartyHp = jest.fn()

jest.mock('@/plugins/src/cheat/runtime/cheats', () => ({
  Cheats: {
    setGod: (...a: unknown[]) => setGod(...(a as [boolean])),
    setThrough: (...a: unknown[]) => setThrough(...(a as [boolean])),
    setAutoWin: (...a: unknown[]) => setAutoWin(...(a as [boolean])),
    clearInterpreter: () => clearInterpreter(),
    battleVictory: () => battleVictory(),
    battleEscape: () => battleEscape(),
    battleDefeat: () => battleDefeat(),
    battleAbort: () => battleAbort(),
    healParty: () => healParty(),
  },
}))

jest.mock('@/plugins/src/cheat/runtime/cheats-run', () => ({
  RunCheats: {
    ensureHooks: () => ensureHooks(),
    setEncounter: (...a: unknown[]) => setEncounter(...(a as [boolean])),
    setMenuEnabled: (...a: unknown[]) => setMenuEnabled(...(a as [boolean])),
    setSaveEnabled: (...a: unknown[]) => setSaveEnabled(...(a as [boolean])),
    setClickMove: (...a: unknown[]) => setClickMove(...(a as [boolean])),
    setFollowersVisible: (...a: unknown[]) => setFollowersVisible(...(a as [boolean])),
    setClickTeleport: (...a: unknown[]) => setClickTeleport(...(a as [boolean])),
    setResourceSkip: (...a: unknown[]) => setResourceSkip(...(a as [boolean])),
    setFullscreen: (...a: unknown[]) => setFullscreen(...(a as [boolean])),
    popScene: () => popScene(),
    pushScene: (...a: unknown[]) => pushScene(...(a as [string])),
    clearPictures: () => clearPictures(),
    clearOverlay: () => clearOverlay(),
    clearMoveRoute: () => clearMoveRoute(),
    closeAllWindows: () => closeAllWindows(),
    gotoTitle: () => gotoTitle(),
    gotoMap: () => gotoMap(),
    fadeIn: () => fadeIn(),
    resumeAfterError: () => resumeAfterError(),
    setEnemyHp: (...a: unknown[]) => setEnemyHp(...(a as [string])),
    setPartyHp: (...a: unknown[]) => setPartyHp(...(a as [string])),
  },
}))

import { applyRunAction, applyRunFlag, applySpeed, runActionNeedsClose } from '@/plugins/src/cheat/runtime/apply-run'

describe('applySpeed / applyRunFlag', () => {
  afterEach(() => {
    delete (window as Window & { ChayaBoost?: unknown }).ChayaBoost
    delete (window as Window & { ChayaEdit?: unknown }).ChayaEdit
    delete (globalThis as { ConfigManager?: unknown }).ConfigManager
    jest.clearAllMocks()
  })

  it('applySpeed is a no-op without Boost', () => {
    expect(() => applySpeed(2, 4)).not.toThrow()
  })

  it('passes walk/run when Boost.rates exists', () => {
    const rates = jest.fn()
    ;(window as Window & { ChayaBoost?: { rates: typeof rates } }).ChayaBoost = { rates }
    applySpeed(1.5, 3)
    expect(rates).toHaveBeenCalledWith({ walk: 1.5, run: 3 })
  })

  it('alwaysDash: prefers Boost.dash, else ConfigManager', () => {
    applyRunFlag('alwaysDash', true)
    expect(ensureHooks).toHaveBeenCalled()
    ;(globalThis as { ConfigManager: { alwaysDash: boolean } }).ConfigManager = { alwaysDash: false }
    applyRunFlag('alwaysDash', true)
    expect(ConfigManager.alwaysDash).toBe(true)

    const dash = jest.fn()
    ;(window as Window & { ChayaBoost?: { dash: typeof dash } }).ChayaBoost = { dash }
    applyRunFlag('alwaysDash', false)
    expect(dash).toHaveBeenCalledWith(false)
  })

  it('dispatches each flag to the matching API', () => {
    const autoTalk = jest.fn()
    ;(window as Window & { ChayaEdit?: { autoTalk: typeof autoTalk } }).ChayaEdit = { autoTalk }

    const cases: Array<[RunFlagKey, () => void]> = [
      ['fullscreen', () => expect(setFullscreen).toHaveBeenCalledWith(true)],
      ['god', () => expect(setGod).toHaveBeenCalledWith(true)],
      ['autoWin', () => expect(setAutoWin).toHaveBeenCalledWith(true)],
      ['through', () => expect(setThrough).toHaveBeenCalledWith(false)],
      ['autotalk', () => expect(autoTalk).toHaveBeenCalledWith(true)],
      ['encounter', () => expect(setEncounter).toHaveBeenCalledWith(false)],
      ['menuEnabled', () => expect(setMenuEnabled).toHaveBeenCalledWith(true)],
      ['saveEnabled', () => expect(setSaveEnabled).toHaveBeenCalledWith(false)],
      ['clickMove', () => expect(setClickMove).toHaveBeenCalledWith(true)],
      ['followers', () => expect(setFollowersVisible).toHaveBeenCalledWith(false)],
      ['clickTeleport', () => expect(setClickTeleport).toHaveBeenCalledWith(true)],
      ['resourceSkip', () => expect(setResourceSkip).toHaveBeenCalledWith(false)],
    ]
    for (const [key, assert] of cases) {
      jest.clearAllMocks()
      applyRunFlag(key, key === 'fullscreen' || key === 'god' || key === 'autoWin' || key === 'autotalk' || key === 'menuEnabled' || key === 'clickMove' || key === 'clickTeleport')
      assert()
    }
  })
})

describe('applyRunAction / runActionNeedsClose', () => {
  afterEach(() => jest.clearAllMocks())

  it('scene:pop / scene:status', () => {
    applyRunAction('scene:pop' as RunActionId)
    expect(popScene).toHaveBeenCalled()
    applyRunAction('scene:status')
    expect(pushScene).toHaveBeenCalledWith('status')
  })

  it('dispatches system / battle actions', () => {
    applyRunAction('fix:clearEvent')
    expect(clearInterpreter).toHaveBeenCalled()
    applyRunAction('fix:clearOverlay')
    expect(clearOverlay).toHaveBeenCalled()
    applyRunAction('battle:victory')
    expect(battleVictory).toHaveBeenCalled()
    applyRunAction('battle:enemyHp1')
    expect(setEnemyHp).toHaveBeenCalledWith('one')
    applyRunAction('battle:partyHp0')
    expect(setPartyHp).toHaveBeenCalledWith('zero')
    applyRunAction('battle:partyHeal')
    expect(healParty).toHaveBeenCalled()
  })

  it('unknown actions do not throw', () => {
    expect(() => applyRunAction('fix:unknown' as RunActionId)).not.toThrow()
  })

  it('runActionNeedsClose: scene and return-to-title/map', () => {
    expect(runActionNeedsClose('scene:equip')).toBe(true)
    expect(runActionNeedsClose('fix:title')).toBe(true)
    expect(runActionNeedsClose('fix:map')).toBe(true)
    expect(runActionNeedsClose('battle:victory')).toBe(false)
    expect(runActionNeedsClose('fix:fadeIn')).toBe(false)
  })
})
