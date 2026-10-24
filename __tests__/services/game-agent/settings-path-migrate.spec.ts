import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * `constants/paths` binds `DATA_DIR` at first load. Isolate via CHAYA_DATA_DIR + resetModules.
 */
describe('game-agent settings path migrate', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-agent-settings-'))
  const prevData = process.env.CHAYA_DATA_DIR

  beforeEach(() => {
    process.env.CHAYA_DATA_DIR = tmp
    jest.resetModules()
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
  })

  afterAll(() => {
    if (prevData === undefined) delete process.env.CHAYA_DATA_DIR
    else process.env.CHAYA_DATA_DIR = prevData
    fs.rmSync(tmp, { recursive: true, force: true })
    jest.resetModules()
  })

  test('迁入 data/game-agent/settings.json 并删除根上旧文件', async () => {
    const paths = await import('@/constants/paths')
    const settings = await import('@/services/game-agent/settings')
    const legacy = path.join(paths.DATA_DIR, 'game-agent-settings.json')
    fs.mkdirSync(paths.DATA_DIR, { recursive: true })
    fs.writeFileSync(
      legacy,
      `${JSON.stringify({
        version: 1,
        defaultProfileId: 'ollama-local',
        profiles: [
          {
            id: 'ollama-local',
            label: 'Local Ollama',
            provider: 'ollama',
            endpoint: 'http://127.0.0.1:11434',
            defaultModel: 'x',
            temperature: 0.2,
            keepAlive: '10m',
            proxy: '',
            proxyProtocols: {},
            proxyHeaders: {},
          },
        ],
      })}\n`
    )
    const loaded = settings.loadGameAgentSettings()
    expect(loaded.profiles[0].defaultModel).toBe('x')
    expect(fs.existsSync(settings.GAME_AGENT_SETTINGS_PATH)).toBe(true)
    expect(fs.existsSync(legacy)).toBe(false)
    expect(settings.GAME_AGENT_SETTINGS_PATH.startsWith(paths.GAME_AGENT_DIR)).toBe(true)
  })
})
