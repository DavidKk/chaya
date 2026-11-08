import { StoryLoopDetector } from '@/plugins/mv/src/agent/runtime/companion-core/story-loop-detector'

describe('StoryLoopDetector', () => {
  let detector: StoryLoopDetector

  beforeEach(() => {
    detector = new StoryLoopDetector(10)
  })

  test('detects and suppresses period-2 ping-pong cycle [A, B, A, B]', () => {
    expect(detector.record({ eventId: 10, x: 1, y: 1 })).toBeNull()
    expect(detector.record({ eventId: 20, x: 2, y: 2 })).toBeNull()
    expect(detector.record({ eventId: 10, x: 1, y: 1 })).toBeNull()

    const res = detector.record({ eventId: 20, x: 2, y: 2 })
    expect(res).not.toBeNull()
    expect(res?.detected).toBe(true)
    expect(res?.cycle).toEqual([10, 20])

    expect(detector.isSuppressed(10)).toBe(true)
    expect(detector.isSuppressed(20)).toBe(true)
    expect(detector.isSuppressed(30)).toBe(false)
  })

  test('detects and suppresses period-3 cycle [A, B, C, A, B, C]', () => {
    detector.record({ eventId: 1, x: 0, y: 0 })
    detector.record({ eventId: 2, x: 0, y: 0 })
    detector.record({ eventId: 3, x: 0, y: 0 })
    detector.record({ eventId: 1, x: 0, y: 0 })
    detector.record({ eventId: 2, x: 0, y: 0 })

    const res = detector.record({ eventId: 3, x: 0, y: 0 })
    expect(res?.detected).toBe(true)
    expect(res?.cycle).toEqual([1, 2, 3])

    expect(detector.isSuppressed(1)).toBe(true)
    expect(detector.isSuppressed(2)).toBe(true)
    expect(detector.isSuppressed(3)).toBe(true)
  })

  test('detects consecutive repeats [A, A, A]', () => {
    detector.record({ eventId: 5, x: 0, y: 0 })
    detector.record({ eventId: 5, x: 0, y: 0 })
    const res = detector.record({ eventId: 5, x: 0, y: 0 })
    expect(res?.detected).toBe(true)
    expect(res?.cycle).toEqual([5])
    expect(detector.isSuppressed(5)).toBe(true)
  })

  test('clearing detector resets history and suppressions', () => {
    detector.suppress(99, 60_000)
    expect(detector.isSuppressed(99)).toBe(true)
    detector.clear()
    expect(detector.isSuppressed(99)).toBe(false)
    expect(detector.getSuppressedEventIds()).toEqual([])
  })

  test('detects longer cycles and keeps suppression until an explicit release', () => {
    for (const eventId of [1, 2, 3, 4, 1, 2, 3, 4]) detector.record({ eventId })
    expect(detector.getSuppressedEventIds()).toEqual([1, 2, 3, 4])
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000)
    expect(detector.isSuppressed(1)).toBe(true)
    detector.release(1)
    expect(detector.isSuppressed(1)).toBe(false)
    expect(detector.isSuppressed(2)).toBe(true)
    clock.mockRestore()
  })

  test('does not suppress repeated productive interactions', () => {
    for (let level = 0; level < 6; level++) detector.record({ eventId: 1, madeProgress: true })
    expect(detector.isSuppressed(1)).toBe(false)
  })
})
