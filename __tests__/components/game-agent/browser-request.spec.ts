import { buildBrowserAgentProfileTools, createBrowserGameAgentRequest } from '@/components/game-agent/browserRequest'

const store = new Map<string, string>()
Object.assign(globalThis, {
  location: { origin: 'https://chaya.example' },
  localStorage: {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  },
})

beforeEach(() => localStorage.clear())

test('Edge adapter completes create, edit, delete, and reload with the shared settings shape', async () => {
  const request = createBrowserGameAgentRequest({ connected: false })
  const initial = await request('/api/integration/game-agent')
  const initialBody = await initial.json()
  expect(initialBody.settings.profiles[0]).toMatchObject({ label: 'Local Ollama', provider: 'ollama' })

  const office = { ...initialBody.settings.profiles[0], id: 'office', label: 'Office Ollama' }
  const created = await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({ settings: { ...initialBody.settings, profiles: [...initialBody.settings.profiles, office] } }),
  })
  expect((await created.json()).settings.profiles.map((profile: { label: string }) => profile.label)).toEqual(['Local Ollama', 'Office Ollama'])

  const edited = { ...office, label: 'Edge Office', defaultModel: 'qwen3' }
  await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({ settings: { ...initialBody.settings, profiles: [initialBody.settings.profiles[0], edited] } }),
  })

  const reloaded = await request('/api/integration/game-agent')
  expect((await reloaded.json()).settings).toMatchObject({
    defaultProfileId: 'ollama-local',
    profiles: [{ label: 'Local Ollama' }, { id: 'office', label: 'Edge Office', defaultModel: 'qwen3' }],
  })

  const removed = await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({ settings: { ...initialBody.settings, profiles: [initialBody.settings.profiles[0]] } }),
  })
  expect((await removed.json()).settings.profiles.map((profile: { id: string }) => profile.id)).toEqual(['ollama-local'])
})

test('Edge Agent tools delete a configuration by display name', async () => {
  const request = createBrowserGameAgentRequest({ connected: false })
  const initial = await request('/api/integration/game-agent')
  const initialSettings = (await initial.json()).settings
  await request('/api/integration/game-agent', {
    method: 'PUT',
    body: JSON.stringify({
      settings: { ...initialSettings, profiles: [...initialSettings.profiles, { ...initialSettings.profiles[0], id: 'flow-local', label: 'Flow Local' }] },
    }),
  })
  const tool = buildBrowserAgentProfileTools().find((candidate) => candidate.name === 'chaya_agent_profile_delete')

  expect(tool?.description).toContain('delete the Agent named Flow Local')
  expect(await tool?.execute({ target: 'Flow Local' })).toMatchObject({
    ok: true,
    result: { deleted: { id: 'flow-local', label: 'Flow Local' }, count: 1 },
  })
  const reloaded = await request('/api/integration/game-agent')
  expect((await reloaded.json()).settings.profiles.map((profile: { id: string }) => profile.id)).toEqual(['ollama-local'])
})

test('Edge adapter enables the shared Agent panel from cached models without requiring a game', async () => {
  localStorage.setItem('chaya.gameAgent.models', JSON.stringify({ 'ollama-local': { endpoint: 'http://127.0.0.1:11434', models: [{ name: 'gemma4' }] } }))
  const request = createBrowserGameAgentRequest({ connected: false })
  const status = await request('/api/game-agent/status?gameId=chaya-console')
  expect(await status.json()).toMatchObject({ available: true, gameOnline: false, reason: null, profiles: [{ provider: 'ollama', online: true }] })
})

test('Edge adapter falls back when the configured model is no longer installed', async () => {
  localStorage.setItem(
    'chaya.gameAgent.settings',
    JSON.stringify({
      version: 1,
      defaultProfileId: 'ollama-local',
      profiles: [
        {
          id: 'ollama-local',
          label: 'Local Ollama',
          provider: 'ollama',
          endpoint: 'http://127.0.0.1:11434',
          defaultModel: 'removed-model',
          temperature: 0.2,
          keepAlive: '10m',
        },
      ],
    })
  )
  localStorage.setItem('chaya.gameAgent.models', JSON.stringify({ 'ollama-local': { endpoint: 'http://127.0.0.1:11434', models: [{ name: 'available-model' }] } }))

  const status = await createBrowserGameAgentRequest({ connected: false })('/api/game-agent/status?gameId=chaya-console')
  expect((await status.json()).profiles[0].defaultModel).toBe('available-model')
})

test('Edge adapter reports game state separately from Agent availability', async () => {
  const request = createBrowserGameAgentRequest({ connected: true })
  const status = await request('/api/game-agent/status?gameId=demo')
  expect(await status.json()).toMatchObject({ available: false, gameOnline: true, profiles: [{ provider: 'ollama' }] })
})

test('Edge adapter caches models fetched automatically from an endpoint', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'gemma4' }] }) }) as Response)
  try {
    const request = createBrowserGameAgentRequest({ connected: true })
    const initial = await request('/api/integration/game-agent')
    const profile = (await initial.json()).settings.profiles[0]
    const refreshed = await request('/api/integration/game-agent', {
      method: 'POST',
      body: JSON.stringify({ action: 'models', profile }),
    })
    expect((await refreshed.json()).models).toEqual([{ name: 'gemma4' }])

    const cached = await request('/api/integration/game-agent')
    expect((await cached.json()).models).toEqual({ 'ollama-local': [{ name: 'gemma4' }] })
  } finally {
    globalThis.fetch = previousFetch
  }
})
