import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { getTranslateEngineSwitches, setTranslateEngineSwitches } from '@/services/translate/engine-switches'

const dirs = { data: '', gameA: '', gameB: '' }

jest.mock('@/lib/game/toolkit-data', () => ({
  toolkitDataDir: () => dirs.data,
}))

jest.mock('@/services/game/binding', () => ({
  getResolvedFromConfig: () => ({ ok: true, remote: false, contentRoot: dirs.gameA }),
}))

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-engines-'))
  dirs.data = path.join(root, 'data')
  dirs.gameA = path.join(root, 'game-a')
  dirs.gameB = path.join(root, 'game-b')
  fs.mkdirSync(dirs.gameA, { recursive: true })
  fs.mkdirSync(dirs.gameB, { recursive: true })
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
  const gameFile = JSON.parse(fs.readFileSync(gameContentPath(dirs.gameA, 'switches'), 'utf8')) as { agents?: unknown; bing?: boolean }
  expect(gameFile.agents).toBeUndefined()
  expect(gameFile.bing).toBe(false)
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
