import { EventEmitter } from 'node:events'
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http'

import * as serviceMode from '@/lib/service-mode/mode'
import { observeHttpRequest, registerHttpRequestTracing } from '@/services/log/http-server'
import { startOperation } from '@/services/log/operation'
import { watchSlowHttpRequest } from '@/services/log/slow-http'

jest.mock('@/services/log/slow-http', () => ({ watchSlowHttpRequest: jest.fn(() => jest.fn()) }))

jest.mock('@/services/log/operation', () => ({
  operationId: (value?: string) => (value && /^[a-zA-Z0-9:_-]{1,100}$/.test(value) ? value : 'generated-id'),
  startOperation: jest.fn(() => ({ startedAt: 1000, elapsedMs: () => 25, end: jest.fn() })),
}))

it('does not observe requests when dev switches to browser mode', () => {
  jest.spyOn(serviceMode, 'canUseDisk').mockReturnValue(false)
  observeHttpRequest({ request: { url: '/game', headers: {} } as IncomingMessage, response: {} as ServerResponse })
  expect(startOperation).not.toHaveBeenCalled()
  expect(watchSlowHttpRequest).not.toHaveBeenCalled()
})

it('attaches one correlation ID to the native request and logs completion once', () => {
  const request = { url: '/game?private=value', method: 'GET', headers: { 'x-chaya-request-id': 'page:123' } } as unknown as IncomingMessage
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true, setHeader: jest.fn() }) as unknown as ServerResponse
  observeHttpRequest({ request, response })
  expect(response.setHeader).toHaveBeenCalledWith('X-Chaya-Request-Id', 'page:123')
  expect(request.headers['x-chaya-request-started-at']).toBe('1000')
  response.emit('finish')
  response.emit('close')
  const timing = jest.mocked(startOperation).mock.results[0]!.value
  expect(timing.end).toHaveBeenCalledTimes(1)
  expect(timing.end).toHaveBeenCalledWith('completed', { status: 200, phase: 'response-finished' })
  expect(startOperation).toHaveBeenCalledWith('http', 'http.server', { method: 'GET', path: '/game' }, { operationId: 'page:123', start: true })
})

it('records disconnected requests and monitors the log transport without feeding its own stream', () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false, setHeader: jest.fn() }) as unknown as ServerResponse
  observeHttpRequest({ request: { url: '/cheat/actor/1', headers: {} } as IncomingMessage, response })
  response.emit('close')
  expect(jest.mocked(startOperation).mock.results[0]!.value.end).toHaveBeenCalledWith('cancelled', { status: 200, phase: 'connection-closed' })
  jest.mocked(startOperation).mockClear()
  observeHttpRequest({ request: { url: '/api/logs/stream', headers: {} } as IncomingMessage, response })
  response.emit('finish')
  expect(startOperation).toHaveBeenCalledWith('http', 'http.server', { method: undefined, path: '/api/logs/stream' }, { operationId: 'generated-id', start: false })
  expect(jest.mocked(startOperation).mock.results[0]!.value.end).not.toHaveBeenCalled()
  expect(watchSlowHttpRequest).toHaveBeenCalledTimes(2)
})

it('measures SSE setup instead of connection lifetime, including direct writeHead headers', () => {
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    writeHead: jest.fn(),
  }) as unknown as ServerResponse
  observeHttpRequest({ request: { url: '/api/events', method: 'GET', headers: {} } as IncomingMessage, response })
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const finishSlow = jest.mocked(watchSlowHttpRequest).mock.results[0]!.value
  expect(finishSlow).toHaveBeenCalledWith('completed', 200, 'stream-open')
  response.emit('close')
  expect(finishSlow).toHaveBeenCalledTimes(1)
})

it.each([
  [200, 'OK', { 'Content-Type': 'text/event-stream' }],
  [200, undefined, { 'Content-Type': 'text/event-stream' }],
  [200, ['Content-Type', 'text/event-stream']],
])('preserves writeHead overload arguments: %j', (...args) => {
  const original = jest.fn()
  const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: jest.fn(), getHeader: jest.fn(), writeHead: original }) as unknown as ServerResponse
  observeHttpRequest({ request: { url: '/api/events', method: 'GET', headers: {} } as IncomingMessage, response })
  Reflect.apply(response.writeHead, response, args)
  expect(original).toHaveBeenCalledWith(...args)
  expect(jest.mocked(watchSlowHttpRequest).mock.results[0]!.value).toHaveBeenCalledWith('completed', 200, 'stream-open')
})

it('covers static assets but skips upgraded WebSocket connections', () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: jest.fn() }) as unknown as ServerResponse
  observeHttpRequest({ request: { url: '/_next/static/test.js', method: 'GET', headers: {} } as IncomingMessage, response })
  response.emit('finish')
  observeHttpRequest({ request: { url: '/_next/webpack-hmr', headers: { upgrade: 'websocket' } } as IncomingMessage, response })
  expect(watchSlowHttpRequest).toHaveBeenCalledTimes(1)
})

it('observes real native HTTP dispatch and preserves the ID through the response', async () => {
  registerHttpRequestTracing()
  registerHttpRequestTracing()
  const server = createServer((request, response) => {
    expect(request.headers['x-chaya-request-id']).toBe('generated-id')
    response.end('ok')
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    await new Promise<void>((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}/game`, (response) => {
        expect(response.headers['x-chaya-request-id']).toBe('generated-id')
        response.resume()
        response.on('end', resolve)
      }).on('error', reject)
    })
    expect(startOperation).toHaveBeenCalledTimes(1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
