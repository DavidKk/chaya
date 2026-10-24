jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { getTranslateEngineSwitches, setTranslateEngineSwitches } from '@/services/translate/engine-switches'

const dirs = { data: '', gameA: '', gameB: '' }

jest.mock('@/lib/game/toolkit-data', () => ({
  toolkitDataDir: () => dirs.data,
}))

const mockGetResolvedFromConfig = jest.fn((): { ok: boolean; remote?: boolean; contentRoot?: string; error?: string } => ({ ok: true, remote: false, contentRoot: dirs.gameA }))

jest.mock('@/services/game/binding', () => ({
  getResolvedFromConfig: () => mockGetResolvedFromConfig(),
}))

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-engines-'))
  dirs.data = path.join(root, 'data')
  dirs.gameA = path.join(root, 'game-a')
  dirs.gameB = path.join(root, 'game-b')
  fs.mkdirSync(dirs.gameA, { recursive: true })
  fs.mkdirSync(dirs.gameB, { recursive: true })
  mockGetResolvedFromConfig.mockReturnValue({ ok: true, remote: false, contentRoot: dirs.gameA })
})

it('keeps agent entries for every game and leaves platform switches per game', () => {
  setTranslateEngineSwitches({
    switches: { bing: false },
    agents: [{ id: 'a1', profileId: 'gpu', model: 'qwen', enabled: true }],
  })
  const second = getTranslateEngineSwitches(dirs.gameB)
  expect(second.agents).toEqual([{ id: 'a1', profileId: 'gpu', model: 'qwen', enabled: true }])
  expect(second.switches.bing).toBe(true)
  expect(getTranslateEngineSwitches(dirs.gameA).switches.bing).toBe(false)

  const shared = JSON.parse(fs.readFileSync(path.join(dirs.data, 'translate', 'agents.json'), 'utf8')) as { agents: unknown[] }
  expect(shared.agents).toHaveLength(1)
  const gameFile = JSON.parse(fs.readFileSync(gameContentPath(dirs.gameA, 'switches'), 'utf8')) as { agents?: unknown; bing?: boolean; configs?: { bing?: { id?: string } } }
  expect(gameFile.agents).toBeUndefined()
  expect(gameFile.bing).toBe(false)
  const bingId = gameFile.configs?.bing?.id
  expect(typeof bingId).toBe('string')
  expect(bingId).not.toBe('bing')
  expect(bingId).toBe(getTranslateEngineSwitches(dirs.gameA).configs.bing.id)
})

it('adopts an existing per-game agent list into the shared file once', () => {
  fs.mkdirSync(path.dirname(gameContentPath(dirs.gameA, 'switches')), { recursive: true })
  fs.writeFileSync(
    gameContentPath(dirs.gameA, 'switches'),
    `${JSON.stringify({ bing: true, google: true, order: ['agent:a1', 'bing', 'google'], agents: [{ id: 'a1', profileId: 'gpu', model: '', enabled: true }] }, null, 2)}\n`
  )
  expect(getTranslateEngineSwitches(dirs.gameA).agents.map((a) => a.profileId)).toEqual(['gpu'])
  expect(getTranslateEngineSwitches(dirs.gameB).agents.map((a) => a.profileId)).toEqual(['gpu'])
  const migrated = JSON.parse(fs.readFileSync(gameContentPath(dirs.gameA, 'switches'), 'utf8')) as { agents?: unknown }
  expect(migrated.agents).toBeUndefined()
})

it('falls back to shared agents and default platform switches when no game is bound', () => {
  mockGetResolvedFromConfig.mockReturnValue({ ok: false, error: 'no game' })
  const initial = getTranslateEngineSwitches()
  expect(initial.contentRoot).toBe('')
  expect(initial.switches.bing).toBe(true)
  expect(initial.agents).toEqual([])
  expect(initial.configs.bing.id).toBeTruthy()

  const saved = setTranslateEngineSwitches({
    agents: [{ id: 'agent_free', profileId: 'deepseek', model: 'v3', enabled: true }],
  })
  expect(saved.contentRoot).toBe('')
  expect(saved.agents).toHaveLength(1)
  expect(saved.agents[0].id).toBe('agent_free')
  expect(getTranslateEngineSwitches().agents).toEqual(saved.agents)
})
