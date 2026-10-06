import { requestOllama } from '@/lib/translate/engine-http'

function reply(content: string) {
  return jest.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ message: { content } }), { status: 200 }))
}

function sentUser(http: ReturnType<typeof reply>) {
  return JSON.parse(String(http.mock.calls[0][1]?.body)).messages[1].content as string
}

it('frames bare source text for the default translate prompt and strips the echoed label', async () => {
  const http = reply('简体中文：去会客室')
  await expect(requestOllama(http, { text: '応接室へ行く' })).resolves.toBe('去会客室')
  expect(sentUser(http)).toBe('日文：\n応接室へ行く\n\n简体中文：')
})

it('sends text as-is with a custom system prompt', async () => {
  const http = reply('去会客室')
  await requestOllama(http, { text: '译文：\n応接室へ行く', system: '自定义' })
  expect(sentUser(http)).toBe('译文：\n応接室へ行く')
})

it('gives an interactive thinking call enough output budget', async () => {
  const http = reply('译文')
  await requestOllama(http, { text: '長い台詞', think: true, interactive: true })
  expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toMatchObject({ think: true, options: { num_predict: 2048 } })
})

it('retries without thinking only when Ollama rejects that option', async () => {
  const http = jest
    .fn()
    .mockResolvedValueOnce(new Response('model does not support thinking', { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '译文' } })))
  await expect(requestOllama(http, { text: '原文', think: true })).resolves.toBe('译文')
  expect(JSON.parse(String(http.mock.calls[1][1].body)).think).toBe(false)
})
