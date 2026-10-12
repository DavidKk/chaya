import { POST } from '@/app/api/game-agent/model/route.server'
import * as cliComplete from '@/services/game-agent/cli/complete.server'
import { AgentCliError } from '@/services/game-agent/cli/errors'
import * as ollamaClient from '@/services/game-agent/ollama-client'
import * as settingsModule from '@/services/game-agent/settings'
import { clearLaunchToken, issueLaunchToken } from '@/services/runtime/launch-token'

const ctx = { params: Promise.resolve({}) }
const url = 'http://localhost/api/game-agent/model'

afterEach(() => {
  clearLaunchToken()
  jest.restoreAllMocks()
})

test('a launched game can use the server model proxy without receiving its token', async () => {
  jest.spyOn(ollamaClient, 'streamOllamaChat').mockResolvedValue({ role: 'assistant', content: 'ok' })
  const launch = issueLaunchToken({ gameRoot: '/games/demo', libraryId: 'demo' })
  const response = await POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Launch-Token': launch.token, Origin: 'null', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ profileId: 'ollama-local', model: 'demo', messages: [{ role: 'user', content: 'hello' }], tools: [] }),
    }),
    ctx
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ message: { role: 'assistant', content: 'ok' } })
  expect(ollamaClient.streamOllamaChat).toHaveBeenCalledWith(expect.objectContaining({ token: undefined }), expect.any(Function), expect.any(Function))
})

test('CLI instances answer through the CLI runner instead of Ollama', async () => {
  const settings = settingsModule.loadGameAgentSettings()
  jest.spyOn(settingsModule, 'loadGameAgentSettings').mockReturnValue({
    ...settings,
    profiles: [...settings.profiles, { ...settings.profiles[0], id: 'cursor-agent', label: 'Cursor', provider: 'cursor', endpoint: '', defaultModel: '' }],
  })
  const ollama = jest.spyOn(ollamaClient, 'streamOllamaChat')
  const cli = jest
    .spyOn(cliComplete, 'completeWithCli')
    .mockResolvedValue({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_saves_save', arguments: { slot: 1 } } }] })
  const tools = [{ name: 'chaya_saves_save', inputSchema: { type: 'object', properties: {} } }]
  const response = await POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'cursor-agent', model: 'auto', messages: [{ role: 'user', content: '帮我存档一下' }], tools }),
    }),
    ctx
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ message: { tool_calls: [{ function: { name: 'chaya_saves_save' } }] } })
  expect(cli).toHaveBeenCalledWith(expect.objectContaining({ id: 'cursor-agent', provider: 'cursor' }), expect.objectContaining({ model: 'auto', tools }))
  expect(ollama).not.toHaveBeenCalled()
})

test('CLI failures keep their error code and HTTP status', async () => {
  const settings = settingsModule.loadGameAgentSettings()
  jest.spyOn(settingsModule, 'loadGameAgentSettings').mockReturnValue({ ...settings, profiles: [{ ...settings.profiles[0], provider: 'gemini', endpoint: '' }] })
  jest.spyOn(cliComplete, 'completeWithCli').mockRejectedValue(new AgentCliError('AGENT_AUTH_REQUIRED', '该实例尚未授权'))
  const response = await POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: settings.profiles[0].id, model: 'auto', messages: [{ role: 'user', content: 'hi' }], tools: [] }),
    }),
    ctx
  )
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ error: { code: 'AGENT_AUTH_REQUIRED', message: '该实例尚未授权' } })
})

test('an unknown launch token cannot use the model proxy', async () => {
  const response = await POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Launch-Token': 'unknown', Origin: 'https://example.test', 'Sec-Fetch-Site': 'cross-site' },
      body: '{}',
    }),
    ctx
  )
  expect(response.status).toBe(401)
})
