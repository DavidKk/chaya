import path from 'node:path'

import * as gameService from '@/services/game'

jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: () => ({ get: () => null, close: jest.fn() }),
}))
jest.mock('@/services/game', () => ({
  getResolvedFromConfig: jest.fn(),
}))

import { loadGameEditCatalog } from '@/services/game/game-edit-catalog'

describe('loadGameEditCatalog with RGSS', () => {
  it('loads items, weapons, actors, variables and switches from .rvdata2 files', () => {
    jest.mocked(gameService.getResolvedFromConfig).mockReturnValueOnce({
      ok: true,
      contentRoot: path.resolve('fixtures/game-rgss-vx-ace'),
      engine: 'VX Ace',
      kind: 'rgss',
    } as never)
    const res = loadGameEditCatalog()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.length).toBeGreaterThan(0)
    expect(res.items[0].name).toBe('月光药水')
    expect(res.items[0].description).toBe('恢复少量生命值。')
  })
})
