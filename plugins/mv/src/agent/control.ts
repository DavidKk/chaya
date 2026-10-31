import type { ControlArbiter, ControlLease } from '@/lib/game-agent/companion/core/types'
import type { AgentCommand } from '@/lib/runtime/agent-protocol'

type Control = { arbiter: ControlArbiter; lease: ControlLease }
let installed: { arbiter: ControlArbiter; runtimeInstanceId: string } | undefined

export function installAgentControl(arbiter: ControlArbiter, runtimeInstanceId: string): () => void {
  const binding = { arbiter, runtimeInstanceId }
  installed = binding
  return () => {
    if (installed === binding) installed = undefined
  }
}

export function isGameWrite(command: AgentCommand): boolean {
  if (['game.state', 'game.ui', 'game.history', 'game.snap', 'plugins.list', 'edit.catalog', 'edit.state', 'agent.task'].includes(command.method)) return false
  if (command.method === 'game.saves') return !['snapshot', 'nativeSnapshot'].includes(command.params.op)
  return true
}

/** All automation entry points pass this boundary, including saves and edit tools. */
export async function withAgentControl<T>(command: AgentCommand, ownerId: string | undefined, explicit: Control | undefined, run: (control?: Control) => Promise<T>): Promise<T> {
  if (!isGameWrite(command)) return run(explicit)
  let control = explicit
  let temporary = false
  if (installed) {
    const { arbiter, runtimeInstanceId } = installed
    if (explicit && explicit.arbiter !== arbiter) throw new Error('CONTROL_ARBITER_MISMATCH')
    if (!control) {
      const lease = arbiter.currentLease()
      if (ownerId) {
        // A late tool response must never reacquire a stopped task's authority.
        if (!lease || lease.ownerId !== ownerId) throw new Error('CONTROL_REVOKED')
        control = { arbiter, lease }
      } else {
        control = { arbiter, lease: arbiter.acquire({ runtimeInstanceId, ownerId: `external:${command.id}`, scope: 'game', allowedActions: ['*'], requestedAt: Date.now() }) }
        temporary = true
      }
    }
  }
  if (!control) return run()
  control.arbiter.assertCurrent(control.lease)
  // Keep asynchronous mutations fenced until they settle, even after revocation.
  const untrack = control.arbiter.trackInput(control.lease, () => undefined)
  try {
    return await run(control)
  } finally {
    untrack()
    if (temporary) control.arbiter.release(control.lease)
  }
}
