import { clearLaunchToken, issueLaunchToken, peekLaunchToken } from '@/services/runtime/launch-token'

describe('launch token lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-10-09T00:00:00Z'))
    clearLaunchToken()
  })

  afterEach(() => {
    clearLaunchToken()
    jest.useRealTimers()
  })

  it('issues a durable v1 session and throttles persisted touches to one minute', () => {
    const session = issueLaunchToken({ gameRoot: '/games/a', libraryId: 'a' })
    expect(session.persistence).toBe('durable')
    const initial = session.lastSeenAt
    jest.advanceTimersByTime(59_999)
    expect(peekLaunchToken(session.token)?.lastSeenAt).toBe(initial)
    jest.advanceTimersByTime(1)
    expect(peekLaunchToken(session.token)?.lastSeenAt).toBe(initial + 60_000)
  })

  it('expires after 24 hours of inactivity and can be explicitly revoked', () => {
    const expired = issueLaunchToken({ gameRoot: '/games/a', libraryId: 'a' })
    jest.advanceTimersByTime(24 * 60 * 60_000 + 1)
    expect(peekLaunchToken(expired.token)).toBeNull()

    const revoked = issueLaunchToken({ gameRoot: '/games/b', libraryId: 'b' })
    clearLaunchToken(revoked.token)
    expect(peekLaunchToken(revoked.token)).toBeNull()
  })
})
