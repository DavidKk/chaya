import { requestOllama } from '@/lib/translate/engine-http'
import { ollamaJaToZh } from '@/services/translate/ollama-translate'

jest.mock('@/lib/translate/engine-http', () => ({
  ...jest.requireActual('@/lib/translate/engine-http'),
  requestOllama: jest.fn(),
}))

const src = '準備ができたら、宿屋の前で待っていてくれ。'

beforeEach(() => jest.mocked(requestOllama).mockReset())

it('retries with the stricter prompt when an interactive call echoes the source', async () => {
  jest.mocked(requestOllama).mockResolvedValueOnce(src).mockResolvedValueOnce('准备好了就在旅店前等我。')
  await expect(ollamaJaToZh(src, { interactive: true })).resolves.toBe('准备好了就在旅店前等我。')
  expect(requestOllama).toHaveBeenCalledTimes(2)
  expect(jest.mocked(requestOllama).mock.calls[1][1].text).toBe(`译文：\n${src}`)
  expect(jest.mocked(requestOllama).mock.calls[0][1].think).toBe(false)
  expect(jest.mocked(requestOllama).mock.calls[1][1].think).toBe(true)
})

it('uses thinking on a long offline passage without an extra classification call', async () => {
  jest.mocked(requestOllama).mockResolvedValue('译文')
  await ollamaJaToZh(src.repeat(7))
  expect(requestOllama).toHaveBeenCalledTimes(1)
  expect(jest.mocked(requestOllama).mock.calls[0][1].think).toBe(true)
})

it('does not retry an interactive call after an error such as a timeout', async () => {
  jest.mocked(requestOllama).mockRejectedValueOnce(new Error('timeout'))
  await expect(ollamaJaToZh(src, { interactive: true })).rejects.toThrow('timeout')
  expect(requestOllama).toHaveBeenCalledTimes(1)
})
