export type TargetVisit = {
  eventId: number
  kind?: string
  x?: number
  y?: number
  timestamp: number
  progressKey?: string
}

export type LoopDetectionResult = {
  detected: boolean
  cycle?: number[]
  reason?: string
}

export class StoryLoopDetector {
  private history: TargetVisit[] = []
  private suppressedUntil = new Map<number, number>()

  constructor(private readonly windowSize = 12) {}

  public record(target: { eventId: number; kind?: string; x?: number; y?: number; progressKey?: string; madeProgress?: boolean }): LoopDetectionResult | null {
    const last = this.history[this.history.length - 1]
    if (target.madeProgress || (last?.progressKey !== undefined && target.progressKey !== undefined && last.progressKey !== target.progressKey)) {
      this.history = []
    }
    const now = Date.now()
    this.history.push({
      ...target,
      timestamp: now,
    })
    if (this.history.length > this.windowSize) {
      this.history.shift()
    }
    return this.detectAndSuppressCycles()
  }

  public isSuppressed(eventId: number): boolean {
    const until = this.suppressedUntil.get(eventId)
    if (!until) return false
    if (Date.now() >= until) {
      this.suppressedUntil.delete(eventId)
      return false
    }
    return true
  }

  public suppress(eventId: number, durationMs = Infinity): void {
    this.suppressedUntil.set(eventId, Date.now() + durationMs)
  }

  public release(eventId: number): void {
    this.suppressedUntil.delete(eventId)
    this.history = this.history.filter((visit) => visit.eventId !== eventId)
  }

  public clear(): void {
    this.history = []
    this.suppressedUntil.clear()
  }

  public getSuppressedEventIds(): number[] {
    const result: number[] = []
    const now = Date.now()
    for (const [id, until] of this.suppressedUntil.entries()) {
      if (now < until) result.push(id)
      else this.suppressedUntil.delete(id)
    }
    return result
  }

  public detectAndSuppressCycles(): LoopDetectionResult | null {
    const n = this.history.length
    if (n < 2) return null

    const ids = this.history.map((h) => h.eventId)

    if (n >= 3 && ids[n - 1] === ids[n - 2] && ids[n - 2] === ids[n - 3]) {
      this.suppress(ids[n - 1])
      return {
        detected: true,
        cycle: [ids[n - 1]],
        reason: `Repeated interaction with event #${ids[n - 1]}`,
      }
    }

    for (let period = 2; period <= Math.floor(n / 2); period++) {
      const cycle = ids.slice(n - period)
      if (new Set(cycle).size < 2 || !cycle.every((id, index) => id === ids[n - 2 * period + index])) continue
      for (const id of cycle) this.suppress(id)
      return { detected: true, cycle, reason: `Repeated target cycle: ${cycle.join(' -> ')}` }
    }

    return null
  }
}
