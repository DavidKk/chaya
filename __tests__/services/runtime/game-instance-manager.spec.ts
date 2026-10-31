import {
  checkAndReclaimIdleInstances,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  listCloudGameInstances,
  terminateCloudGameInstance,
} from '@/services/runtime/game-instance-manager'

describe('game-instance-manager (cloud gaming instance lifecycle & idle cleanup)', () => {
  it('lists running cloud game instances and computes idle/remaining countdowns', () => {
    const list = listCloudGameInstances()
    expect(Array.isArray(list)).toBe(true)
    for (const inst of list) {
      expect(typeof inst.pid).toBe('number')
      expect(typeof inst.gameTitle).toBe('string')
      expect(typeof inst.idleSeconds).toBe('number')
      expect(inst.idleTimeoutSeconds).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS)
      expect(typeof inst.remainingIdleSeconds).toBe('number')
      expect(inst.screenshotUrl).toContain('/api/remote/screenshot')
      expect(inst.streamUrl).toContain('/play')
    }
  })

  it('runs checkAndReclaimIdleInstances without error', async () => {
    const res = await checkAndReclaimIdleInstances()
    expect(res).toHaveProperty('reclaimed')
    expect(Array.isArray(res.reclaimed)).toBe(true)
  })
})
