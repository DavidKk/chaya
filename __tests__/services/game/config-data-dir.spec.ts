import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('saveConfig with CHAYA_DATA_DIR (packaged)', () => {
  const prevDataDir = process.env.CHAYA_DATA_DIR
  let dataDir = ''

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-data-'))
    process.env.CHAYA_DATA_DIR = dataDir
    jest.resetModules()
  })

  afterAll(() => {
    if (prevDataDir === undefined) delete process.env.CHAYA_DATA_DIR
    else process.env.CHAYA_DATA_DIR = prevDataDir
    jest.resetModules()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('writes chaya.config.json under CHAYA_DATA_DIR, not ROOT', async () => {
    const { CONFIG_FILE_PATH, DATA_DIR, ROOT_PATH } = await import('@/constants/paths')
    expect(DATA_DIR).toBe(dataDir)
    expect(CONFIG_FILE_PATH).toBe(path.join(dataDir, 'chaya.config.json'))
    expect(CONFIG_FILE_PATH.startsWith(ROOT_PATH)).toBe(false)

    const { saveConfig, loadConfig } = await import('@/services/game/config')
    saveConfig({ gameRoot: '/tmp/demo-game', library: [] })
    expect(fs.existsSync(CONFIG_FILE_PATH)).toBe(true)
    expect(loadConfig().gameRoot).toBe('/tmp/demo-game')
  })
})
