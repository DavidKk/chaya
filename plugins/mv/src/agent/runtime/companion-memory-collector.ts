import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { CompanionDomainEvent, ContextStamp, FactView, MemoryInput } from '@/lib/game-agent/companion/types'

type Observation = Omit<MemoryInput, 'memoryEpoch' | 'recordingRevision'> & {
  memoryEpoch?: number
  recordingRevision?: number
  bytes: number
}

/** Bound initialization backlog as well as normal ingestion; hooks never await storage. */
export function collectCompanionMemory(
  facts: { current(): FactView; stamp?(): ContextStamp; subscribe(listener: (event: CompanionDomainEvent, source: SourceGameEvent) => void): () => void },
  memory: GameplayMemoryStore,
  report: (message: string) => void
) {
  const queue: Observation[] = []
  let queueBytes = 0
  let initialized = false
  let closed = false
  let draining: Promise<void> | null = null
  let warned = false
  const warn = (message: string) => {
    if (!warned) report(message)
    warned = true
  }
  const ready = memory.ready().then(() => {
    initialized = true
    for (const item of queue) {
      item.memoryEpoch ??= memory.getEpoch()
      item.recordingRevision ??= memory.getRecording().revision
    }
  })

  const drain = () => {
    if (draining) return
    draining = (async () => {
      await ready
      while (queue.length) {
        const item = queue.shift()!
        queueBytes -= item.bytes
        const { bytes: _bytes, ...input } = item
        try {
          await memory.ingest({
            ...input,
            memoryEpoch: input.memoryEpoch ?? memory.getEpoch(),
            recordingRevision: input.recordingRevision ?? memory.getRecording().revision,
          })
        } catch (error) {
          warn(`Gameplay memory collection degraded: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })().finally(() => {
      draining = null
      if (queue.length) drain()
    })
  }
  const unsubscribe = facts.subscribe((domainEvent, source) => {
    if (closed) return
    const observation: Observation = {
      domainEvent,
      source,
      stamp: typeof facts.stamp === 'function' ? facts.stamp() : facts.current().stamp,
      coveredSourceCursor: { producerId: source.producer.id, epoch: source.producer.epoch, sourceSeq: source.producer.sourceSeq },
      ...(initialized ? { memoryEpoch: memory.getEpoch(), recordingRevision: memory.getRecording().revision } : {}),
      bytes: 0,
    }
    observation.bytes = new TextEncoder().encode(JSON.stringify(observation)).byteLength
    if (observation.bytes > 256 * 1024) return warn('Gameplay memory observation exceeded the field budget')
    while (queue.length >= 256 || queueBytes + observation.bytes > 1024 * 1024) {
      const ordinary = queue.findIndex((item) => item.domainEvent?.kind === 'action')
      if (ordinary < 0 && domainEvent.kind === 'action') return warn('Gameplay memory backlog is full; action details were dropped')
      const [removed] = queue.splice(ordinary >= 0 ? ordinary : 0, 1)
      if (!removed) break
      queueBytes -= removed.bytes
      warn('Gameplay memory backlog reached its budget; older details were dropped')
    }
    queue.push(observation)
    queueBytes += observation.bytes
    drain()
  })

  return {
    async close() {
      closed = true
      unsubscribe()
      if (queue.length && !draining) drain()
      await draining
    },
  }
}
