import { execSync } from 'node:child_process'

import { clearGameProcessCache, findRunningGameProcesses, isAnyGameProcessRunning } from '@/services/game/game-process'

jest.mock('node:child_process', () => ({ ...jest.requireActual('node:child_process'), execSync: jest.fn(() => '') }))
jest.mock('@/services/game/rgss-runtime', () => ({ anyRgssRunning: () => false, findRgssSessionByPid: () => undefined }))

beforeEach(() => {
  clearGameProcessCache()
  jest.mocked(execSync).mockReturnValue('')
})

afterEach(() => clearGameProcessCache())

describe('game-process service', () => {
  it('scans running processes without crashing', () => {
    const list = findRunningGameProcesses()
    expect(Array.isArray(list)).toBe(true)
    for (const item of list) {
      expect(typeof item.pid).toBe('number')
      expect(typeof item.command).toBe('string')
      expect(typeof item.isMain).toBe('boolean')
    }
  })

  it('returns boolean for isAnyGameProcessRunning', () => {
    const result = isAnyGameProcessRunning()
    expect(typeof result).toBe('boolean')
  })

  it.each([
    '/Games/Heroes of Swords/www',
    '/Games/Heroes of Swords/www --window-hidden --disable-background-timer-throttling',
    '"/Games/Heroes of Swords/www" --window-hidden',
    '--nwapp-path="/Games/Heroes of Swords/www" --window-hidden',
  ])('recognizes a running NW game with a spaced path: %s', (args) => {
    if (process.platform === 'win32') return
    jest.mocked(execSync).mockReturnValue(`123 /Users/Shared/Chaya.app/Contents/MacOS/nwjs ${args}\n`)
    expect(findRunningGameProcesses('/Games/Heroes of Swords/www')).toEqual([{ pid: 123, command: expect.any(String), isMain: true, contentRoot: '/Games/Heroes of Swords/www' }])
  })
})
