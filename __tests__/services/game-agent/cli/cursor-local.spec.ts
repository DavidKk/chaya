import { maskEmail } from '@/services/game-agent/cli/account'
import { extractCursorLoginUrl, parseCursorAbout, parseCursorStatus } from '@/services/game-agent/cli/auth/cursor-local.server'

test('reads login state from `agent status --format json`', () => {
  const stdout = JSON.stringify({ status: 'authenticated', isAuthenticated: true, userInfo: { email: 'player@example.com' } })
  expect(parseCursorStatus(stdout)).toEqual({ signedIn: true, email: 'player@example.com' })
  expect(parseCursorStatus('{"isAuthenticated":false}')).toEqual({ signedIn: false, email: undefined })
  expect(parseCursorStatus('Not logged in')).toBeNull()
})

test('reads email and plan from `agent about --format json`', () => {
  const stdout = `warning: update available\n${JSON.stringify({ cliVersion: '2026.06.26', subscriptionTier: 'Pro', userEmail: 'player@example.com' })}`
  expect(parseCursorAbout(stdout)).toEqual({ email: 'player@example.com', plan: 'Pro' })
})

test('extracts the login link from colored CLI output', () => {
  const output = `\u001b[1mOpen this link to log in:\u001b[0m\n  \u001b[4mhttps://cursor.com/loginDeepControl?challenge=abc&uuid=1-2&mode=login\u001b[0m\n`
  expect(extractCursorLoginUrl(output)).toBe('https://cursor.com/loginDeepControl?challenge=abc&uuid=1-2&mode=login')
  expect(extractCursorLoginUrl('Waiting for browser…')).toBeNull()
  expect(extractCursorLoginUrl('https://evil.example/cursor.com/login')).toBeNull()
})

test('only an email hint leaves the service', () => {
  expect(maskEmail('player@example.com')).toBe('p***@example.com')
  expect(maskEmail('not-an-email')).toBeUndefined()
})
