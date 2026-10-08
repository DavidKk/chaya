import { POST } from '@/app/api/game-agent/model/route.server'
import * as ollamaClient from '@/services/game-agent/ollama-client'
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
  expect(ollamaClient.streamOllamaChat).toHaveBeenCalledWith(expect.objectContaining({ token: undefined }), expect.any(Function))
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
