import { findRunningGameProcesses, isAnyGameProcessRunning } from '@/services/game/game-process'

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
})
