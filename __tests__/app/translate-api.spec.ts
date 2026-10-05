import { POST } from '@/app/api/translate/route.server'
import { resolveGame } from '@/lib/game'
import { hasManagementAccess } from '@/services/access/management'
import { peekLaunchToken } from '@/services/runtime/launch-token'
import { agentJaToZh, listTranslateAgents } from '@/services/translate/agent-translate'
import { resolveTranslateContentRoot } from '@/services/translate/fill-missing'
import { setTranslationPlaySettings } from '@/services/translate/play-settings'
import { translateDialogue } from '@/services/translate/realtime'

jest.mock('@/services/access/api', () => ({ mayAccessApi: jest.fn(async () => true) }))
jest.mock('@/services/access/management', () => ({ hasManagementAccess: jest.fn() }))
jest.mock('@/services/runtime/launch-token', () => ({ peekLaunchToken: jest.fn() }))
jest.mock('@/lib/game', () => ({ resolveGame: jest.fn() }))
jest.mock('@/services/disk-ops', () => ({ requireDisk: () => null }))
jest.mock('@/services/translate/fill-missing', () => ({ resolveTranslateContentRoot: jest.fn() }))
jest.mock('@/services/translate/play-settings', () => ({ getTranslationPlaySettings: jest.fn(), setTranslationPlaySettings: jest.fn() }))
jest.mock('@/services/translate/realtime', () => ({ translateDialogue: jest.fn(), benchmarkLocalModel: jest.fn() }))
jest.mock('@/services/translate/agent-translate', () => ({ agentJaToZh: jest.fn(), listTranslateAgents: jest.fn() }))

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Launch-Token': 'game-A-token' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )

beforeEach(() => {
  jest.mocked(resolveTranslateContentRoot).mockReturnValue('/games/B')
})

it('translates the launch credential game even when the console is bound to another game', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(false)
  jest.mocked(peekLaunchToken).mockReturnValue({ token: 'game-A-token', gameRoot: '/games/A' } as ReturnType<typeof peekLaunchToken>)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: '/games/A/www', remote: false } as ReturnType<typeof resolveGame>)
  jest.mocked(translateDialogue).mockResolvedValue({ items: [], contentRoot: '/games/A/www', engines: ['ollama'], elapsedMs: 10 })
  const response = await post({ mode: 'realtime', texts: ['こんにちは'], contentRoot: '/games/B' })
  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(translateDialogue).toHaveBeenCalledWith('/games/A/www', ['こんにちは'], expect.any(AbortSignal))
})

it('rejects stale setting saves after the selected game changes', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  const response = await post({ mode: 'play-settings', contentRoot: '/games/A', settings: { mode: 'realtime' } })
  expect(response.status).toBe(409)
  expect((await response.json()).error.code).toBe('GAME_CHANGED')
  expect(setTranslationPlaySettings).not.toHaveBeenCalled()
})

it('ai mode translates one text with the chosen agent instance', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(agentJaToZh).mockResolvedValue('你好')
  const response = await post({ mode: 'ai', text: 'こんにちは', ai: { profileId: ' p1 ', model: 'm1', extra: 1 }, interactive: true })
  expect(response.status).toBe(200)
  expect((await response.json()).text).toBe('你好')
  expect(agentJaToZh).toHaveBeenCalledWith('こんにちは', { profileId: 'p1', model: 'm1' }, { interactive: true, signal: expect.any(AbortSignal) })
})

it('ai mode rejects empty text', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(agentJaToZh).mockClear()
  const response = await post({ mode: 'ai', text: '   ' })
  expect(response.status).toBe(400)
  expect(agentJaToZh).not.toHaveBeenCalled()
})

it('agents mode lists instances without endpoints or tokens', async () => {
  jest.mocked(hasManagementAccess).mockReturnValue(true)
  jest.mocked(listTranslateAgents).mockReturnValue({ profiles: [{ id: 'p1', label: 'GPU', defaultModel: 'qwen' }], models: {} })
  const response = await post({ mode: 'agents' })
  expect(response.status).toBe(200)
  expect((await response.json()).profiles).toEqual([{ id: 'p1', label: 'GPU', defaultModel: 'qwen' }])
})
