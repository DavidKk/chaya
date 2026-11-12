import { EventEmitter } from 'node:events'

const mockWorker = new EventEmitter() as EventEmitter & {
  unref: jest.Mock
  postMessage: jest.Mock
  terminate: jest.Mock
}
mockWorker.unref = jest.fn()
mockWorker.postMessage = jest.fn()
mockWorker.terminate = jest.fn()

jest.mock('node:fs', () => ({
  __esModule: true,
  default: { existsSync: jest.fn(() => true) },
}))
jest.mock('node:worker_threads', () => ({
  Worker: jest.fn(() => mockWorker),
}))

import { commandSeedJobWorker, resetSeedJobWorkerClientForTests } from '@/services/translate/seed-job-worker-client'

describe('seed job worker client', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetSeedJobWorkerClientForTests()
    mockWorker.removeAllListeners()
    mockWorker.unref.mockClear()
    mockWorker.postMessage.mockClear()
    mockWorker.terminate.mockClear()
  })

  afterEach(() => {
    resetSeedJobWorkerClientForTests()
    jest.useRealTimers()
  })

  it('rejects a command when the worker never becomes ready', async () => {
    const command = commandSeedJobWorker('snapshot')
    const rejected = expect(command).rejects.toThrow('did not become ready in 10000ms')

    await jest.runOnlyPendingTimersAsync()
    await rejected
    expect(mockWorker.terminate).toHaveBeenCalled()
  })

  it('sends commands after the worker reports ready', async () => {
    const command = commandSeedJobWorker('snapshot')
    mockWorker.emit('message', { type: 'ready', version: 1 })

    await Promise.resolve()
    await Promise.resolve()
    expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'request', id: 1, command: 'snapshot' }))
    mockWorker.emit('message', { type: 'response', id: 1, ok: false, error: 'snapshot unavailable' })
    await expect(command).rejects.toThrow('snapshot unavailable')
  })
})
