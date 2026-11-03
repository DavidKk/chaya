import { callAgentGame } from '@/services/runtime/agent-bridge'
import { captureGamePreview, clearGamePreviews } from '@/services/runtime/game-preview'

jest.mock('@/services/runtime/agent-bridge', () => ({ callAgentGame: jest.fn() }))
jest.mock('@/services/game/rgss-runtime', () => ({ findRgssSessionByRoomId: jest.fn(() => null) }))

beforeEach(() => clearGamePreviews())
const shot = { mimeType: 'image/jpeg', data: 'cHJldmlldw==', width: 800, height: 450 }

it('coalesces requests across tabs, observer aliases and requested widths', async () => {
  jest.mocked(callAgentGame).mockResolvedValue(shot)
  const results = await Promise.all([captureGamePreview('a'), captureGamePreview('a:observer', 1280), captureGamePreview('a', 300)])
  expect(results).toEqual([shot, shot, shot])
  expect(callAgentGame).toHaveBeenCalledTimes(1)
  await captureGamePreview('b')
  expect(callAgentGame).toHaveBeenCalledTimes(2)
})

it('caches failures for three minutes instead of repeatedly waiting for the game', async () => {
  let now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  jest.mocked(callAgentGame).mockRejectedValue(new Error('offline'))
  expect(await captureGamePreview('a')).toBeNull()
  now += 179_999
  expect(await captureGamePreview('a')).toBeNull()
  expect(callAgentGame).toHaveBeenCalledTimes(1)
  now++
  await captureGamePreview('a')
  expect(callAgentGame).toHaveBeenCalledTimes(2)
})

it.each([
  [-20, 160],
  [100_000, 1280],
  [NaN, 800],
])('bounds requested width %s to %s', async (input, expected) => {
  jest.mocked(callAgentGame).mockResolvedValue(shot)
  await captureGamePreview('a', input)
  expect(callAgentGame).toHaveBeenCalledWith('a', 'game.snap', { maxWidth: expected }, 3000)
})
