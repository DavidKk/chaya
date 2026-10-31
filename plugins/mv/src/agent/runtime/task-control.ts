import type { ControlArbiter } from '@/lib/game-agent/companion/core/types'
import type { AgentTask } from '@/lib/game-agent/runtime'

export async function runWithTaskControl<T>(
  arbiter: ControlArbiter,
  runtimeInstanceId: string,
  task: Pick<AgentTask, 'id' | 'capability'>,
  signal: AbortSignal,
  execute: () => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  if (task.capability !== 'play') return execute()
  const lease = arbiter.acquire({ runtimeInstanceId, ownerId: task.id, scope: 'game', allowedActions: ['*'], requestedAt: Date.now() })
  const revoke = () => arbiter.revoke(lease, 'user_stop')
  signal.addEventListener('abort', revoke, { once: true })
  try {
    signal.throwIfAborted()
    return await execute()
  } finally {
    signal.removeEventListener('abort', revoke)
    arbiter.release(lease)
  }
}
