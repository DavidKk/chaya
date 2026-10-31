import { compactLogEntry } from '@/lib/log/entry'
import { appendBrowserLog } from '@/lib/log/link-log-store'
import type { TimingEntry, TimingReporter } from '@/lib/log/timing'

let uploadEnabled = false

/** Only an explicitly local service may persist console diagnostics. */
export function setBrowserTimingUploadEnabled(enabled: boolean) {
  uploadEnabled = enabled
}

/** Bound and batch diagnostics separately from the requests being measured. Never retry log uploads. */
export function createBrowserTimingReporter(upload?: (entries: TimingEntry[]) => Promise<unknown>): TimingReporter {
  const queue: TimingEntry[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let uploading = false
  const schedule = () => {
    if (!upload || timer || uploading || !queue.length) return
    timer = setTimeout(() => {
      timer = undefined
      uploading = true
      const entries = queue.splice(0, 100)
      void Promise.resolve()
        .then(() => upload(entries))
        .catch(() => {})
        .finally(() => {
          uploading = false
          schedule()
        })
    }, 150)
  }
  return (entry) => {
    const bounded = compactLogEntry({ ...entry, id: 'timing' })
    entry = { ...bounded, meta: (bounded.meta ?? {}) as Record<string, unknown> }
    appendBrowserLog(entry)
    if (!upload) return
    queue.push(entry)
    if (queue.length > 500) queue.splice(0, queue.length - 500)
    schedule()
  }
}

const localReporter = createBrowserTimingReporter(async (entries) => {
  if (!uploadEnabled || typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) return
  await fetch('/api/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
    signal: AbortSignal.timeout(5000),
  })
})

export const reportBrowserTiming: TimingReporter = (entry) => {
  if (typeof window !== 'undefined') localReporter(entry)
}
