import { OsxHostShell } from '@/services/platform/host/osx'
import { spawnDetached } from '@/services/platform/host/shared'

jest.mock('@/services/platform/host/shared', () => ({
  assertPathExists: jest.fn(),
  spawnDetached: jest.fn(async () => {}),
}))
jest.mock('@/lib/game/shell-layout', () => ({ findNwMacBinary: jest.fn() }))

it('disables RAF and canvas capture throttling for hidden game launches', async () => {
  await new OsxHostShell().launchShell('/tmp/Chaya.app', '/tmp/game', { silent: true })
  expect(spawnDetached).toHaveBeenCalledWith(
    'open',
    expect.arrayContaining(['-n', '/tmp/Chaya.app', '--args', '/tmp/game', '--window-hidden', '--disable-raf-throttling', '--disable-background-timer-throttling'])
  )
})

it('preserves ordinary windowed launches and caller arguments', async () => {
  await new OsxHostShell().launchShell('/tmp/Chaya.app', '/tmp/game', { extraArgs: ['--example'] })
  expect(spawnDetached).toHaveBeenCalledWith('open', ['-n', '/tmp/Chaya.app', '--args', '/tmp/game', '--example'])
})
