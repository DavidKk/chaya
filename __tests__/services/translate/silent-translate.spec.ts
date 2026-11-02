import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { extractAndEnsureSeed } from '@/services/extract/ensure-seed'
import { setTranslateEngineSwitches } from '@/services/translate/engine-switches'
import { startSeedJob } from '@/services/translate/seed-job'
import { readSeedJobState } from '@/services/translate/seed-job-state'
import {
  DEFAULT_SILENT_TRANSLATE_CONFIG,
  getSilentTranslateConfig,
  runSilentExtractionAndTranslation,
  setSilentTranslateConfig,
  triggerSilentTranslateIfEnabled,
} from '@/services/translate/silent-translate'

let tmpDir = ''

jest.mock('@/lib/game/toolkit-data', () => ({
  toolkitDataDir: () => tmpDir,
}))

jest.mock('@/services/extract/ensure-seed', () => ({
  extractAndEnsureSeed: jest.fn(),
}))

jest.mock('@/services/translate/seed-job', () => ({
  startSeedJob: jest.fn(),
}))

jest.mock('@/services/translate/engine-switches', () => ({
  getTranslateEngineSwitches: jest.fn(() => ({
    switches: { bing: true, google: true, apple: false, bergamot: false },
    order: ['bing', 'google', 'apple', 'bergamot'],
    agents: [],
    enabled: ['bing', 'google'],
  })),
  setTranslateEngineSwitches: jest.fn(),
}))

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-silent-test-'))
  jest.clearAllMocks()
})

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

describe('SilentTranslateConfig', () => {
  it('returns default config when file does not exist', () => {
    const config = getSilentTranslateConfig()
    expect(config).toEqual(DEFAULT_SILENT_TRANSLATE_CONFIG)
    expect(config.enabled).toBe(false)
    expect(config.engine).toBe('default')
  })

  it('saves and reads updated config', () => {
    const updated = setSilentTranslateConfig({ enabled: true, engine: 'google' })
    expect(updated).toEqual({ enabled: true, engine: 'google' })

    const read = getSilentTranslateConfig()
    expect(read).toEqual({ enabled: true, engine: 'google' })
  })

  it('does not trigger silent translation when disabled', () => {
    setSilentTranslateConfig({ enabled: false })
    triggerSilentTranslateIfEnabled('/games/demo')
    expect(extractAndEnsureSeed).not.toHaveBeenCalled()
  })
})

describe('runSilentExtractionAndTranslation', () => {
  it('extracts and starts job with default engine when configured as default', async () => {
    jest.mocked(extractAndEnsureSeed).mockReturnValue({
      contentRoot: '/games/demo',
      extractFile: 'extract.json',
      seedFile: 'demo-trans.seed.json',
      unique: 100,
      added: 20,
      total: 100,
    })

    await runSilentExtractionAndTranslation('/games/demo', { enabled: true, engine: 'default' })

    expect(extractAndEnsureSeed).toHaveBeenCalledWith({ contentRoot: '/games/demo', gameId: undefined })
    expect(setTranslateEngineSwitches).not.toHaveBeenCalled()
    expect(startSeedJob).toHaveBeenCalledWith({ contentRoot: '/games/demo', gameId: undefined, engines: undefined })
  })

  it('configures switches and starts job with specific engine when configured', async () => {
    jest.mocked(extractAndEnsureSeed).mockReturnValue({
      contentRoot: '/games/demo',
      extractFile: 'extract.json',
      seedFile: 'demo-trans.seed.json',
      unique: 50,
      added: 10,
      total: 50,
    })

    await runSilentExtractionAndTranslation('/games/demo', { enabled: true, engine: 'google' })

    expect(extractAndEnsureSeed).toHaveBeenCalledWith({ contentRoot: '/games/demo', gameId: undefined })
    expect(setTranslateEngineSwitches).toHaveBeenCalledWith(
      expect.objectContaining({
        switches: { bing: false, google: true, apple: false, bergamot: false },
        order: ['google', 'bing', 'apple', 'bergamot'],
      }),
      '/games/demo'
    )
    expect(startSeedJob).toHaveBeenCalledWith({ contentRoot: '/games/demo', gameId: undefined, engines: ['google'] })
  })

  it('handles extraction failure gracefully without throwing', async () => {
    jest.mocked(extractAndEnsureSeed).mockImplementation(() => {
      throw new Error('Corrupt game data')
    })

    await runSilentExtractionAndTranslation('/games/demo', { enabled: true, engine: 'default' })

    expect(startSeedJob).not.toHaveBeenCalled()
    const state = readSeedJobState('/games/demo')
    expect(state?.status).toBe('error')
    expect(state?.error).toContain('Corrupt game data')
  })

  it('handles translation start failure gracefully without throwing', async () => {
    jest.mocked(extractAndEnsureSeed).mockReturnValue({
      contentRoot: '/games/demo',
      extractFile: 'extract.json',
      seedFile: 'demo-trans.seed.json',
      unique: 10,
      added: 0,
      total: 10,
    })
    jest.mocked(startSeedJob).mockImplementation(() => {
      throw new Error('Worker crash')
    })

    await runSilentExtractionAndTranslation('/games/demo', { enabled: true, engine: 'default' })

    const state = readSeedJobState('/games/demo')
    expect(state?.status).toBe('error')
    expect(state?.error).toContain('Worker crash')
  })
})
