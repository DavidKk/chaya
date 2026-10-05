import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defaultGameAgentSettings, loadGameAgentSettings, normalizeGameAgentEndpoint, saveGameAgentSettings } from '@/services/game-agent/settings'

describe('game agent settings', () => {
  it('provides a local Ollama profile by default', () => {
    const settings = defaultGameAgentSettings()
    expect(settings.profiles).toHaveLength(1)
    expect(settings.profiles[0]).toMatchObject({ id: settings.defaultProfileId, provider: 'ollama', endpoint: 'http://127.0.0.1:11434' })
  })

  it('persists multiple profiles and keeps their labels', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-agent-'))
    const file = path.join(dir, 'settings.json')
    const first = defaultGameAgentSettings().profiles[0]
    saveGameAgentSettings(
      {
        defaultProfileId: 'second',
        profiles: [first, { ...first, id: 'second', label: 'Office Ollama', endpoint: 'http://192.168.1.2:11434/' }],
      },
      file
    )
    expect(loadGameAgentSettings(file)).toMatchObject({
      defaultProfileId: 'second',
      profiles: [{ label: 'Local Ollama' }, { id: 'second', label: 'Office Ollama', endpoint: 'http://192.168.1.2:11434' }],
    })
  })

  it('accepts only HTTP endpoints', () => {
    expect(normalizeGameAgentEndpoint('https://models.example/v1/')).toBe('https://models.example/v1')
    expect(() => normalizeGameAgentEndpoint('file:///tmp/model')).toThrow('HTTP')
    expect(() => normalizeGameAgentEndpoint('not a url')).toThrow('URL')
  })
})
