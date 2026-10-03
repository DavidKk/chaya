/** 下载速度平滑与剩余时间（纯函数） */

export type RateSample = { at: number; bytes: number; rate?: number }

const MIN_SAMPLE_GAP_MS = 500
const SMOOTHING = 0.3
const MIN_RATE_FOR_ETA = 1024

/** 第一次采样只记基准；间隔 ≥ 500 ms 才更新；指数平滑 `0.3·瞬时 + 0.7·旧值` */
export function nextRate(prev: RateSample | undefined, bytes: number, now: number): RateSample {
  if (!prev || bytes < prev.bytes) return { at: now, bytes }
  const dt = now - prev.at
  if (dt < MIN_SAMPLE_GAP_MS) return prev
  const instant = ((bytes - prev.bytes) * 1000) / dt
  return { at: now, bytes, rate: prev.rate == null ? instant : SMOOTHING * instant + (1 - SMOOTHING) * prev.rate }
}

/** 速度低于 1 KB/s 或没有总长时不给 */
export function etaSeconds(received: number | undefined, total: number | undefined, rate: number | undefined): number | undefined {
  if (received == null || !total || !rate || rate < MIN_RATE_FOR_ETA) return undefined
  return Math.max(0, Math.round((total - received) / rate))
}

/** `m:ss` / `h:mm:ss`，与语言无关 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
