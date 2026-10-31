import { prepareCompanionOllama } from '@/services/game-agent/companion-ollama'

const base = () => ({ endpoint: 'http://localhost:11434/', model: 'small', signal: new AbortController().signal })

test('a resident model is reused and does not trigger a preload or unload', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(Response.json({ models: [{ name: 'small:latest', context_length: 16_384 }] }))
  const onStatus = jest.fn()
  expect(await prepareCompanionOllama({ ...base(), fetcher, onStatus })).toMatchObject({ residency: 'warm' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'ready', residency: 'warm' }))
})

test('an evicted model emits loading before the network load and stays resident after readiness', async () => {
  const onStatus = jest.fn()
  const fetcher = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(Response.json({ models: [] }))
    .mockImplementationOnce(async (_url, init) => {
      expect(onStatus).toHaveBeenCalledWith({ phase: 'loading', residency: 'cold' })
      expect(JSON.parse(String(init?.body))).toMatchObject({ messages: [], stream: false, keep_alive: -1, options: { num_ctx: 16_384 } })
      return Response.json({ done: true, load_duration: 12_500_000 })
    })
  await expect(prepareCompanionOllama({ ...base(), fetcher, onStatus, token: 'private-token' })).resolves.toMatchObject({ residency: 'cold', startupLoadMs: 12.5 })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer private-token' })
  expect(onStatus.mock.calls.map(([status]) => status.phase)).toEqual(['loading', 'ready'])
})

test('context changes are reported as loading even when the same model is already resident', async () => {
  const fetcher = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(Response.json({ models: [{ name: 'small:latest', context_length: 4_096 }] }))
    .mockResolvedValueOnce(Response.json({ done: true }))
  await expect(prepareCompanionOllama({ ...base(), fetcher })).resolves.toMatchObject({ residency: 'cold' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('an unsupported residency endpoint is unknown, rather than falsely claiming a cold or warm load', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response('', { status: 404 }))
  const onStatus = jest.fn()
  await expect(prepareCompanionOllama({ ...base(), fetcher, onStatus })).resolves.toMatchObject({ residency: 'unknown' })
  expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'loading' }))
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('cancelling startup propagates abort and never sends an unload request', async () => {
  const controller = new AbortController()
  const fetcher = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(Response.json({ models: [] }))
    .mockImplementationOnce(async (_url, init) => {
      controller.abort()
      init?.signal?.throwIfAborted()
      throw new Error('unreachable')
    })
  const onStatus = jest.fn()
  await expect(prepareCompanionOllama({ ...base(), signal: controller.signal, fetcher, onStatus })).rejects.toMatchObject({ name: 'AbortError' })
  expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'ready' }))
  expect(fetcher).toHaveBeenCalledTimes(2)
})
