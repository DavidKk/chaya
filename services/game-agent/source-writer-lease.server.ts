import type { SourceGameEvent } from '@/lib/game-agent/audit'

export const GAME_LOG_WRITER_LEASE_REJECTED = 'GAME_LOG_WRITER_LEASE_REJECTED'

type Lease = { pluginInstanceId: string; producerEpoch: number; connectionId: string; touchedAt: number }
const STORE_KEY = '__chaya_game_log_writer_leases_v1__'

function leases(): Map<string, Lease> {
  const root = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, Lease> }
  return (root[STORE_KEY] ??= new Map())
}

export class GameLogWriterLeaseError extends Error {
  readonly code = GAME_LOG_WRITER_LEASE_REJECTED

  constructor(readonly runtimeInstanceId: string) {
    super(`游戏运行实例的日志写入连接已被接管：${runtimeInstanceId}`)
    this.name = 'GameLogWriterLeaseError'
  }
}

/**
 * A runtime has one active plugin writer. A higher producer epoch is a
 * restart/takeover; retries from the same connection remain idempotent.
 */
export function assertGameLogWriterLease(event: SourceGameEvent): void {
  const runtime = event.targets.find((target) => target.runtimeInstanceId)
  if (!runtime?.runtimeInstanceId || !runtime.pluginInstanceId || !runtime.connectionId) throw new GameLogWriterLeaseError('unknown')
  const key = runtime.runtimeInstanceId
  const current = leases().get(key)
  const next: Lease = {
    pluginInstanceId: runtime.pluginInstanceId,
    producerEpoch: event.producer.epoch,
    connectionId: runtime.connectionId,
    touchedAt: Date.now(),
  }
  if (!current || event.producer.epoch > current.producerEpoch) {
    leases().set(key, next)
    return
  }
  if (current.pluginInstanceId !== next.pluginInstanceId || current.producerEpoch !== next.producerEpoch || current.connectionId !== next.connectionId) {
    throw new GameLogWriterLeaseError(key)
  }
  current.touchedAt = next.touchedAt
}

export function resetGameLogWriterLeases(): void {
  leases().clear()
}
