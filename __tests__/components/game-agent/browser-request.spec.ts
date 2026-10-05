import { createBrowserGameAgentRequest } from '@/components/game-agent/browserRequest'

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

test('Edge adapter keeps the shared Agent panel visible while execution is unavailable', async () => {
  const request = createBrowserGameAgentRequest({ connected: true })
  const status = await request('/api/game-agent/status?gameId=demo')
  expect(await status.json()).toMatchObject({ available: false, gameOnline: true, profiles: [{ provider: 'ollama' }] })
})
