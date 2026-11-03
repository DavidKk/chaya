/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useRemoteCover } from '@/components/remote-play/useRemoteCover'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const STORAGE_KEY = 'chaya_remote_play_covers_v1'
const snapshot = 'data:image/jpeg;base64,c25hcA=='
const title = 'data:image/jpeg;base64,dGl0bGU='
let host: HTMLDivElement
let root: Root
let current: ReturnType<typeof useRemoteCover>
const videoRef = { current: null as HTMLVideoElement | null }

function Probe({ gameId }: { gameId?: string }) {
  const cover = useRemoteCover(gameId, videoRef)
  useEffect(() => {
    current = cover
  }, [cover])
  return <output>{cover.coverImage}</output>
}

async function select(gameId?: string) {
  await act(async () => root.render(<Probe gameId={gameId} />))
}

beforeEach(() => {
  videoRef.current = null
  localStorage.clear()
  host = document.createElement('div')
  root = createRoot(host)
  window.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ cover: title }) })
})

it('removes the previous game’s cached frame immediately when another game is selected', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: { image: snapshot, savedAt: 1 } }))
  await select('a')
  jest.mocked(fetch).mockReturnValue(new Promise(() => {}))
  await select('b')
  expect(host.textContent).toBe('')
})

it('captures a gameplay frame per game and bounds persistent storage to four games', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ cover: null }) } as Response)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(['a', 'b', 'c', 'd'].map((id, index) => [id, { image: title, savedAt: index }]))))
  await select('e')
  const drawImage = jest.fn()
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(snapshot)
  videoRef.current = { videoWidth: 1920, videoHeight: 1080, readyState: 2 } as HTMLVideoElement
  act(() => current.captureCover())
  expect(host.textContent).toBe(snapshot)
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
  expect(Object.keys(saved)).toHaveLength(4)
  expect(saved.e.image).toBe(snapshot)
  expect(saved.a).toBeUndefined()
  expect(drawImage).toHaveBeenCalledWith(videoRef.current, 0, 0, 960, 540)
})

afterEach(() => {
  act(() => root.unmount())
  jest.useRealTimers()
})

it('replaces a saved gameplay frame with static artwork and never captures over it', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: { image: snapshot, savedAt: 1 } }))
  await select('a')
  expect(host.textContent).toBe(title)
  expect(fetch).toHaveBeenCalledTimes(1)
  const draw = jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
  videoRef.current = { videoWidth: 800, videoHeight: 600, readyState: 2 } as HTMLVideoElement
  act(() => current.captureCover())
  expect(draw).not.toHaveBeenCalled()
})

it('clears another game’s frame while loading and ignores stale responses', async () => {
  let resolveA!: (value: Response) => void
  let resolveB!: (value: Response) => void
  jest
    .mocked(fetch)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveA = resolve
      })
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveB = resolve
      })
    )
  await select('a')
  await select('b')
  expect(host.textContent).toBe('')
  await act(async () => resolveB({ ok: true, json: async () => ({ cover: title }) } as Response))
  await act(async () => resolveA({ ok: true, json: async () => ({ cover: snapshot }) } as Response))
  expect(host.textContent).toBe(title)
  expect(fetch).toHaveBeenLastCalledWith('/api/game/cover?gameId=b', expect.any(Object))
})

it('renders safely before a game has been selected', async () => {
  await select()
  expect(host.textContent).toBe('')
  expect(fetch).not.toHaveBeenCalled()
})

it('does not apply the old unscoped cache to a different game', async () => {
  localStorage.setItem('chaya_remote_play_cover', snapshot)
  await select('b')
  expect(host.textContent).toBe(title)
})

it('keeps the gradient fallback after a failed cover request without polling', async () => {
  jest.useFakeTimers()
  jest.mocked(fetch).mockRejectedValue(new Error('offline'))
  await select('b')
  await act(async () => jest.advanceTimersByTime(180_000))
  expect(host.textContent).toBe('')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('limits fallback video capture to once per three minutes across page lifecycle events', async () => {
  jest.useFakeTimers()
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ cover: null }) } as Response)
  const drawImage = jest.fn()
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(snapshot)
  await select('a')
  videoRef.current = { videoWidth: 800, videoHeight: 600, readyState: 2 } as HTMLVideoElement
  act(() => {
    current.captureCover()
    window.dispatchEvent(new Event('pagehide'))
    current.captureCover()
  })
  expect(drawImage).toHaveBeenCalledTimes(1)
  act(() => jest.advanceTimersByTime(180_000))
  act(() => current.captureCover())
  expect(drawImage).toHaveBeenCalledTimes(2)
})
