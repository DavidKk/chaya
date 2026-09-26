import { createTranslationRpc, type TranslationPacket } from '@/lib/runtime/translation-rpc'

it('carries large translation data in bounded messages and correlates concurrent responses', async () => {
  const sent: TranslationPacket[] = []
  const game = createTranslationRpc(
    (packet) => web.receive(packet),
    async (input) => ({ status: 200, data: { text: input.body?.text } })
  )
  const web = createTranslationRpc((packet) => {
    sent.push(packet)
    game.receive(packet)
  })
  try {
    const large = '原文译文'.repeat(12_000)
    const results = await Promise.all([
      web.request({ path: '/api/translate-cache', method: 'POST', body: { text: large } }),
      web.request({ path: '/api/translate', method: 'POST', body: { text: 'small' } }),
    ])
    expect(results.map((result) => result.data.text)).toEqual([large, 'small'])
    expect(sent.length).toBeGreaterThan(2)
    expect(sent.every((packet) => Buffer.byteLength(JSON.stringify(packet)) < 16_384)).toBe(true)
  } finally {
    web.dispose()
    game.dispose()
  }
})

it('disconnect rejects outstanding requests and cancels game operations', async () => {
  let operationSignal: AbortSignal | undefined
  const game = createTranslationRpc(
    (packet) => web.receive(packet),
    async (_input, signal) => {
      operationSignal = signal
      return new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ status: 400, data: {} }), { once: true }))
    }
  )
  const web = createTranslationRpc((packet) => game.receive(packet))
  const result = web.request({ path: '/api/translate', method: 'POST' })
  const rejected = expect(result).rejects.toThrow('游戏连接已断开')
  web.dispose()
  game.dispose()
  await rejected
  expect(operationSignal?.aborted).toBe(true)
})

it('forwards user cancellation without replaying writes', async () => {
  const send = jest.fn()
  const web = createTranslationRpc(send)
  const abort = new AbortController()
  const pending = web.request({ path: '/api/translate', method: 'POST' }, abort.signal)
  const rejected = expect(pending).rejects.toThrow('已取消')
  abort.abort()
  await rejected
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cancel' }))
  web.dispose()
})
