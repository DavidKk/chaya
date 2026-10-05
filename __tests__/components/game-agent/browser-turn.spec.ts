/** @jest-environment jsdom */
import { ReadableStream } from 'node:stream/web'
import { TextDecoder, TextEncoder } from 'node:util'

jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))

import { createBrowserAgentRuntime } from '@/components/game-agent/browserTurn'
import { registerPageTools } from '@/initializer/webmcp/register-page-tools'
import { clearLinkLogs, readLinkLogs } from '@/lib/log/link-log-store'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'

beforeAll(() => {
  class TestResponse {
    constructor(readonly body: ReadableStream<Uint8Array>) {}
    async text() {
      const reader = this.body.getReader()
      const decoder = new TextDecoder()
      let value = ''
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return value
        value += decoder.decode(chunk.value, { stream: true })
      }
    }
  }
  Object.assign(globalThis, { ReadableStream, Response: TestResponse, TextDecoder, TextEncoder })
  Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: jest.fn(async () => undefined) } })
})

beforeEach(() => clearLinkLogs())

test('Edge Agent executes a registered WebMCP tool without a connected game', async () => {
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  const controller = new AbortController()
  const execute = jest.fn(async () => ({ ok: true, value: 2 }))
  await registerPageTools('test-agent', [{ name: 'page_test', description: 'Test page tool', inputSchema: { type: 'object', properties: {} }, execute }], controller.signal)
  const chat = streamOllamaChat as jest.MockedFunction<typeof streamOllamaChat>
  chat.mockResolvedValueOnce({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'page_test', arguments: {} } }] }).mockResolvedValueOnce({
    role: 'assistant',
    content: '调用成功。',
  })

  const response = createBrowserAgentRuntime().start({
    profile: { id: 'local', label: 'Local', provider: 'ollama', endpoint: 'http://127.0.0.1:11434', defaultModel: 'gemma', temperature: 0.2, keepAlive: '10m' },
    model: 'gemma',
    prompt: '测试页面工具',
    locale: 'zh-CN',
  })
  const text = await response.text()

  expect(execute).toHaveBeenCalledWith({})
  expect(text).toContain('"type":"tool.completed"')
  expect(text).toContain('"ok":true')
  expect(text).toContain('调用成功。')
  expect(readLinkLogs()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'ChayaAgent', message: 'tool.started page_test' }),
      expect.objectContaining({ source: 'ChayaAgent', level: 'ok', message: 'tool.completed page_test ok' }),
    ])
  )
  controller.abort()
})
