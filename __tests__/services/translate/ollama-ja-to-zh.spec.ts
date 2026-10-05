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
})

it('does not retry an interactive call after an error such as a timeout', async () => {
  jest.mocked(requestOllama).mockRejectedValueOnce(new Error('timeout'))
  await expect(ollamaJaToZh(src, { interactive: true })).rejects.toThrow('timeout')
  expect(requestOllama).toHaveBeenCalledTimes(1)
})
