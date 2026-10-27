export class MemorySchemaError extends Error {
  readonly code = 'MEMORY_SCHEMA_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'MemorySchemaError'
  }
}

export class MemoryConflictError extends Error {
  readonly code = 'REQUEST_CONFLICT' as const
  constructor(message = 'Memory request conflict') {
    super(message)
    this.name = 'MemoryConflictError'
  }
}

export class MemoryStaleError extends Error {
  readonly code = 'MEMORY_EPOCH_CHANGED' as const
  constructor(message = 'stale memory epoch') {
    super(message)
    this.name = 'MemoryStaleError'
  }
}

export class MemoryPersistenceError extends Error {
  readonly code = 'PERSISTENCE_DEGRADED' as const
  constructor(message = 'memory persistence unavailable') {
    super(message)
    this.name = 'MemoryPersistenceError'
  }
}
