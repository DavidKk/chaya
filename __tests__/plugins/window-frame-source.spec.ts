/** @jest-environment jsdom */
import { WindowFrameSource } from '@/plugins/rgss/src/window-frame-source'

const host = window as any
let source: WindowFrameSource
let post: jest.Mock
let draw: jest.Mock
let track: { stop: jest.Mock }
let images: any[]

beforeEach(() => {
  jest.useFakeTimers()
  post = jest.fn()
  draw = jest.fn()
  track = { stop: jest.fn() }
  images = []
  host.webkit = { messageHandlers: { chaya: { postMessage: post } } }
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: jest.fn(() => ({ active: true, getTracks: () => [track] })),
  })
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as any)
  jest.spyOn(window, 'Image').mockImplementation(() => {
    const image = { naturalWidth: 816, naturalHeight: 624, onload: null, onerror: null, src: '' }
    images.push(image)
    return image as any
  })
  source = new WindowFrameSource(jest.fn())
})

afterEach(() => {
  source.stop()
  delete host.webkit
  delete host.__chaya_stream_frame
  jest.useRealTimers()
})

const generation = () => JSON.parse(post.mock.calls[0][0]).generation

it('starts once, waits for a real frame and acknowledges only after drawing it', async () => {
  const first = source.start()
  expect(source.start()).toBe(first)
  expect(post).toHaveBeenCalledTimes(1)
  host.__chaya_stream_frame({ generation: generation(), sequence: 1, image: 'data:image/jpeg;base64,eA==' })
  expect(draw).not.toHaveBeenCalled()
  images[0].onload()
  await expect(first).resolves.toMatchObject({ active: true })
  expect(draw).toHaveBeenCalledTimes(1)
  const canvas = (HTMLCanvasElement.prototype.captureStream as jest.Mock).mock.instances[0]
  expect(canvas.width).toBe(816)
  expect(canvas.height).toBe(624)
  expect(JSON.parse(post.mock.calls[1][0])).toEqual({ type: 'host.stream.ack', generation: generation(), sequence: 1 })
  source.stop()
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(host.__chaya_stream_frame).toBeUndefined()
})

it('discards stale frame decode after stopping instead of drawing into a new session', async () => {
  const first = source.start()
  const rejected = expect(first).rejects.toThrow('stopped')
  host.__chaya_stream_frame({ generation: generation(), sequence: 1, image: 'data:image/jpeg;base64,eA==' })
  source.stop()
  images[0].onload()
  await rejected
  expect(draw).not.toHaveBeenCalled()
})

it('reports native denial and first-frame timeouts without using file or HTTP previews', async () => {
  const first = source.start()
  const rejected = expect(first).rejects.toThrow('permission denied')
  host.__chaya_stream_frame({ generation: generation(), error: 'Screen recording permission denied' })
  await rejected
  expect(track.stop).toHaveBeenCalled()
  const next = source.start()
  const timedOut = expect(next).rejects.toThrow('timed out')
  jest.advanceTimersByTime(6000)
  await timedOut
  expect(draw).not.toHaveBeenCalled()
})

it('returns the rejected promise when native capture fails synchronously during start', async () => {
  post.mockImplementation((json: string) => {
    const packet = JSON.parse(json)
    if (packet.active) host.__chaya_stream_frame({ generation: packet.generation, error: 'Capture unavailable' })
  })
  await expect(source.start()).rejects.toThrow('Capture unavailable')
  expect(track.stop).toHaveBeenCalledTimes(1)
})
