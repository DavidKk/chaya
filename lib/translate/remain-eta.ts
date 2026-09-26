/** 翻译任务剩余时间：只按本会话实测吞吐估算，样本不足不编造。 */

const ETA_MIN_DONE = 8
const ETA_MIN_ELAPSED_MS = 12_000

export function estimateRemainMs(opts: { missing: number; sessionDone: number; startedAt: number | null; now?: number }): number | null {
  const { missing, sessionDone, startedAt } = opts
  if (!startedAt || missing <= 0 || sessionDone < ETA_MIN_DONE) return null
  const elapsed = (opts.now ?? Date.now()) - startedAt
  if (elapsed < ETA_MIN_ELAPSED_MS) return null
  const rate = sessionDone / elapsed
  if (!(rate > 0)) return null
  return Math.round(missing / rate)
}

export function formatRemainEta(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  if (sec < 60) return `约 ${sec} 秒`
  const min = Math.round(sec / 60)
  if (min < 60) return `约 ${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `约 ${h} 小时 ${m} 分` : `约 ${h} 小时`
}
