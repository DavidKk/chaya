import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import {
  type AgentTraceArchive,
  AgentTraceConflictError,
  type AgentTraceExport,
  type AgentTraceSummary,
  sameTraceEvent,
  traceEventKey,
  traceExport,
  traceSummary,
} from '@/lib/game-agent/trace'

type TaskRecord = { id: string; summary: AgentTraceSummary; events?: AgentTaskEvent[] }
type EventRecord = { id: string; taskId: string; seq: number; event: AgentTaskEvent }
type TargetRecord = { id: string; taskId: string; targets: AgentTaskEvent['targets'] }
type SourceRecord = { id: string; taskId?: string; runtimeInstanceId?: string; sourceSeq: number; event: AgentTaskEvent | SourceGameEvent }

const DB_NAME = 'chaya-agent-activity'
const DB_VERSION = 3
const TASKS_STORE = 'tasks'
const EVENTS_STORE = 'events'
const TARGETS_STORE = 'targets'
const SOURCE_EVENTS_STORE = 'sourceEvents'
let writes = Promise.resolve()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(TASKS_STORE)) db.createObjectStore(TASKS_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' })
        events.createIndex('byTask', 'taskId', { unique: false })
      }
      if (!db.objectStoreNames.contains(TARGETS_STORE)) {
        const targets = db.createObjectStore(TARGETS_STORE, { keyPath: 'id' })
        targets.createIndex('byTask', 'taskId', { unique: false })
      }
      if (!db.objectStoreNames.contains(SOURCE_EVENTS_STORE)) {
        const sourceEvents = db.createObjectStore(SOURCE_EVENTS_STORE, { keyPath: 'id' })
        sourceEvents.createIndex('byTask', 'taskId', { unique: false })
        sourceEvents.createIndex('byRuntime', 'runtimeInstanceId', { unique: false })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error || new Error('无法打开 Agent 活动存储'))
  })
}

function request<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(stores, mode)
    const result = run(transaction)
    result.onsuccess = () => resolve(result.result)
    result.onerror = () => reject(result.error || new Error('Agent 活动存储操作失败'))
    transaction.onerror = () => reject(transaction.error || new Error('Agent 活动存储事务失败'))
  })
}

function allByIndex<T>(db: IDBDatabase, storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  return request<T[]>(db, storeName, 'readonly', (transaction) => transaction.objectStore(storeName).index(indexName).getAll(value))
}

function sortEvents(events: AgentTaskEvent[]): AgentTaskEvent[] {
  return events.sort((a, b) => (a.taskSeq ?? a.seq) - (b.taskSeq ?? b.seq) || a.seq - b.seq)
}

async function migrateLegacyEvents(db: IDBDatabase, task: TaskRecord | undefined): Promise<void> {
  if (!task?.events?.length) return
  await request(db, [TASKS_STORE, EVENTS_STORE, TARGETS_STORE, SOURCE_EVENTS_STORE], 'readwrite', (transaction) => {
    const events = transaction.objectStore(EVENTS_STORE)
    const targets = transaction.objectStore(TARGETS_STORE)
    const sourceEvents = transaction.objectStore(SOURCE_EVENTS_STORE)
    for (const event of task.events || []) {
      const id = traceEventKey(task.id, event)
      if (event.producer?.kind === 'game_plugin') {
        const runtime = event.targets?.find((target) => target.runtimeInstanceId)
        if (runtime?.runtimeInstanceId)
          sourceEvents.put({
            id: event.eventId || id,
            taskId: event.correlation?.taskId,
            runtimeInstanceId: runtime.runtimeInstanceId,
            sourceSeq: event.producer.sourceSeq,
            event: event as AgentTaskEvent | SourceGameEvent,
          } satisfies SourceRecord)
      } else {
        events.put({ id, taskId: task.id, seq: event.seq, event } satisfies EventRecord)
      }
      targets.put({ id, taskId: task.id, targets: event.targets || [] } satisfies TargetRecord)
    }
    return transaction.objectStore(TASKS_STORE).put({ id: task.id, summary: task.summary } satisfies TaskRecord)
  })
}

async function findStoredEvent(db: IDBDatabase, taskId: string, event: AgentTaskEvent): Promise<AgentTaskEvent | undefined> {
  const id = traceEventKey(taskId, event)
  const storeName = event.producer?.kind === 'game_plugin' ? SOURCE_EVENTS_STORE : EVENTS_STORE
  const stored = await request<EventRecord | SourceRecord | undefined>(db, storeName, 'readonly', (transaction) => transaction.objectStore(storeName).get(id))
  return stored?.event as AgentTaskEvent | undefined
}

export const browserAgentTraceArchive: AgentTraceArchive = {
  appendSource(event: SourceGameEvent) {
    const operation = writes.then(async () => {
      if (typeof indexedDB === 'undefined') return
      const db = await openDatabase()
      try {
        const current = await request<SourceRecord | undefined>(db, SOURCE_EVENTS_STORE, 'readonly', (transaction) =>
          transaction.objectStore(SOURCE_EVENTS_STORE).get(event.eventId)
        )
        if (current) {
          if (!sameTraceEvent(current.event, event)) throw new AgentTraceConflictError(event.eventId)
          return
        }
        const runtime = event.targets.find((target) => target.runtimeInstanceId)
        await request(db, SOURCE_EVENTS_STORE, 'readwrite', (transaction) =>
          transaction.objectStore(SOURCE_EVENTS_STORE).put({
            id: event.eventId,
            taskId: event.correlation.taskId,
            runtimeInstanceId: runtime?.runtimeInstanceId,
            sourceSeq: event.producer.sourceSeq,
            event,
          } satisfies SourceRecord)
        )
      } finally {
        db.close()
      }
    })
    writes = operation.catch(() => undefined)
    return operation
  },

  append(task, event) {
    const operation = writes.then(async () => {
      if (typeof indexedDB === 'undefined') return
      const db = await openDatabase()
      try {
        const current = await request<TaskRecord | undefined>(db, TASKS_STORE, 'readonly', (transaction) => transaction.objectStore(TASKS_STORE).get(task.id))
        await migrateLegacyEvents(db, current)
        const eventId = traceEventKey(task.id, event)
        const existing = await findStoredEvent(db, task.id, event)
        if (existing) {
          if (!sameTraceEvent(existing, event)) throw new AgentTraceConflictError(eventId)
          return
        }
        const previousCount = current?.summary.eventCount ?? current?.events?.length ?? 0
        const eventCount = previousCount + 1
        const sizeBytes = (current?.summary.sizeBytes || 0) + JSON.stringify(event).length
        await request(db, [TASKS_STORE, EVENTS_STORE, TARGETS_STORE, SOURCE_EVENTS_STORE], 'readwrite', (transaction) => {
          transaction.objectStore(TASKS_STORE).put({ id: task.id, summary: traceSummary(task, eventCount, sizeBytes) } satisfies TaskRecord)
          transaction.objectStore(TARGETS_STORE).put({ id: eventId, taskId: task.id, targets: event.targets || [] } satisfies TargetRecord)
          if (event.producer?.kind === 'game_plugin') {
            const runtime = event.targets?.find((target) => target.runtimeInstanceId)
            transaction.objectStore(SOURCE_EVENTS_STORE).put({
              id: eventId,
              taskId: task.id,
              runtimeInstanceId: runtime?.runtimeInstanceId,
              sourceSeq: event.producer.sourceSeq,
              event: event as unknown as SourceGameEvent,
            } satisfies SourceRecord)
          } else {
            transaction.objectStore(EVENTS_STORE).put({ id: eventId, taskId: task.id, seq: event.seq, event } satisfies EventRecord)
          }
          return transaction.objectStore(TASKS_STORE).get(task.id)
        })
      } finally {
        db.close()
      }
    })
    writes = operation.catch(() => undefined)
    return operation
  },

  async list() {
    if (typeof indexedDB === 'undefined') return []
    const db = await openDatabase()
    try {
      const values = await request<TaskRecord[]>(db, TASKS_STORE, 'readonly', (transaction) => transaction.objectStore(TASKS_STORE).getAll())
      return values.map((item) => item.summary).sort((a, b) => b.updatedAt - a.updatedAt)
    } finally {
      db.close()
    }
  },

  async read(taskId) {
    if (typeof indexedDB === 'undefined') return null
    const db = await openDatabase()
    try {
      const value = await request<TaskRecord | undefined>(db, TASKS_STORE, 'readonly', (transaction) => transaction.objectStore(TASKS_STORE).get(taskId))
      if (!value) return null
      await migrateLegacyEvents(db, value)
      const taskEvents = (await allByIndex<EventRecord>(db, EVENTS_STORE, 'byTask', taskId)).map((item) => item.event)
      const sourceEvents = (await allByIndex<SourceRecord>(db, SOURCE_EVENTS_STORE, 'byTask', taskId)).map((item) => item.event as unknown as AgentTaskEvent)
      return { ...value.summary, events: sortEvents([...taskEvents, ...sourceEvents]), messages: [] } as AgentTask
    } finally {
      db.close()
    }
  },

  async export(taskId): Promise<AgentTraceExport | null> {
    const task = await this.read(taskId)
    return task ? traceExport(task) : null
  },

  async remove(taskId) {
    if (typeof indexedDB === 'undefined') return 0
    const db = await openDatabase()
    try {
      const value = taskId ? await request<TaskRecord | undefined>(db, TASKS_STORE, 'readonly', (transaction) => transaction.objectStore(TASKS_STORE).get(taskId)) : undefined
      const records = taskId ? (value ? [value] : []) : await request<TaskRecord[]>(db, TASKS_STORE, 'readonly', (transaction) => transaction.objectStore(TASKS_STORE).getAll())
      for (const value of records) {
        if (!value) continue
        const events = await allByIndex<EventRecord>(db, EVENTS_STORE, 'byTask', value.id)
        const targets = await allByIndex<TargetRecord>(db, TARGETS_STORE, 'byTask', value.id)
        await request(db, [TASKS_STORE, EVENTS_STORE, TARGETS_STORE], 'readwrite', (transaction) => {
          transaction.objectStore(TASKS_STORE).delete(value.id)
          for (const item of events) transaction.objectStore(EVENTS_STORE).delete(item.id)
          for (const item of targets) transaction.objectStore(TARGETS_STORE).delete(item.id)
          return transaction.objectStore(TASKS_STORE).get(value.id)
        })
      }
      return records.filter(Boolean).length
    } finally {
      db.close()
    }
  },
}
