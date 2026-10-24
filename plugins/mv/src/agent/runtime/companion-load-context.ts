/**
 * Synchronous companion load owner scope.
 * Binds an authorized agent taskId exclusively for the synchronous duration of initiating a load.
 * Does not keep scope open across async delays/promises, avoiding accidental attribution.
 */

let activeLoadOwnerTaskId: string | null = null

export function withCompanionLoadOwner<T>(taskId: string | undefined | null, fn: () => T): T {
  const prev = activeLoadOwnerTaskId
  activeLoadOwnerTaskId = taskId?.trim() || null
  try {
    return fn()
  } finally {
    activeLoadOwnerTaskId = prev
  }
}

export function companionLoadOwner(): string | undefined {
  return activeLoadOwnerTaskId || undefined
}
