import { detectDirectoryCapability, DirectoryAccessBlockedError, pickDirectory } from '@/lib/browser/fsa'

describe('directory capability', () => {
  it('checks secure context before picker support', () => {
    expect(detectDirectoryCapability({ secure: false, hasPicker: false })).toEqual({ state: 'insecure' })
    expect(detectDirectoryCapability({ secure: true, hasPicker: false })).toEqual({ state: 'unsupported' })
    expect(detectDirectoryCapability({ secure: true, hasPicker: true })).toEqual({ state: 'available' })
  })

  it('keeps user cancellation as AbortError', async () => {
    const error = new DOMException('cancelled', 'AbortError')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { showDirectoryPicker: jest.fn(async () => Promise.reject(error)) } })
    await expect(pickDirectory()).rejects.toBe(error)
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('maps runtime SecurityError to a blocked capability', async () => {
    const error = new DOMException('blocked', 'SecurityError')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { showDirectoryPicker: jest.fn(async () => Promise.reject(error)) } })
    const result = pickDirectory()
    await expect(result).rejects.toBeInstanceOf(DirectoryAccessBlockedError)
    await result.catch((caught: DirectoryAccessBlockedError) => expect(caught.capability.state).toBe('blocked'))
    Reflect.deleteProperty(globalThis, 'window')
  })
})
