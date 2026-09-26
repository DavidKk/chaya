/**
 * 控制台切换游戏时，并发 PUT 可能乱序完成。
 * 客户端带上递增 epoch；服务端只接受「不小于当前」的写入，丢弃过期绑定。
 */
let latestGameBindEpoch = 0

export function acceptGameBindEpoch(raw: unknown): { ok: true; epoch: number } | { ok: false; latest: number } {
  const epoch = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  if (epoch > 0 && epoch < latestGameBindEpoch) {
    return { ok: false, latest: latestGameBindEpoch }
  }
  if (epoch > latestGameBindEpoch) latestGameBindEpoch = epoch
  return { ok: true, epoch: latestGameBindEpoch }
}

export function peekGameBindEpoch(): number {
  return latestGameBindEpoch
}

/** 仅测试用：重置进程内 epoch */
export function resetGameBindEpochForTests(): void {
  latestGameBindEpoch = 0
}
