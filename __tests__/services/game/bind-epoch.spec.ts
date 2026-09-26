import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import { acceptGameBindEpoch, peekGameBindEpoch, resetGameBindEpochForTests } from '@/services/game/bind-epoch'

describe('acceptGameBindEpoch', () => {
  beforeEach(() => {
    resetGameBindEpochForTests()
  })

  afterEach(() => {
    resetGameBindEpochForTests()
  })

  it('首次绑定抬高 epoch', () => {
    expect(acceptGameBindEpoch(1)).toEqual({ ok: true, epoch: 1 })
    expect(peekGameBindEpoch()).toBe(1)
  })

  it('更大的 epoch 覆盖', () => {
    acceptGameBindEpoch(2)
    expect(acceptGameBindEpoch(5)).toEqual({ ok: true, epoch: 5 })
  })

  it('过期 epoch 被拒绝（防止 URL 互跳时旧 PUT 回写）', () => {
    acceptGameBindEpoch(10)
    expect(acceptGameBindEpoch(7)).toEqual({ ok: false, latest: 10 })
    expect(peekGameBindEpoch()).toBe(10)
  })

  it('相同 epoch 允许（幂等重试）', () => {
    acceptGameBindEpoch(3)
    expect(acceptGameBindEpoch(3)).toEqual({ ok: true, epoch: 3 })
  })

  it('非数字 / 0 视为 0 且接受但不抬高已有最新值', () => {
    acceptGameBindEpoch(4)
    expect(acceptGameBindEpoch(undefined)).toEqual({ ok: true, epoch: 4 })
    expect(acceptGameBindEpoch('x')).toEqual({ ok: true, epoch: 4 })
    expect(acceptGameBindEpoch(0)).toEqual({ ok: true, epoch: 4 })
  })

  it('模拟乱序：快切 A→B 后迟到的 A 绑定被丢弃', () => {
    // 用户点 A
    expect(acceptGameBindEpoch(1).ok).toBe(true)
    // 立刻点 B
    expect(acceptGameBindEpoch(2).ok).toBe(true)
    // A 的慢响应带着 epoch=1 回来
    expect(acceptGameBindEpoch(1)).toEqual({ ok: false, latest: 2 })
  })
})
