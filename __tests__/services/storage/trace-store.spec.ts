import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import { AgentTraceConflictError } from '@/lib/game-agent/trace'
import { createTraceSqliteStore, type TraceSqliteStore } from '@/services/storage/trace-store'

describe('Trace SQLite Store (F01)', () => {
  let tmpDir: string
  let dbPath: string
  let store: TraceSqliteStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-trace-test-'))
    dbPath = path.join(tmpDir, 'agent-trace', 'trace.sqlite')
    store = createTraceSqliteStore(dbPath)
  })

  afterEach(() => {
    store.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  type TestTraceEvent = AgentTaskEvent & { text?: string }
  const testEvent = (props: { seq: number; taskSeq?: number; at: number; text: string; eventId?: string }): TestTraceEvent => ({
    seq: props.seq,
    taskSeq: props.taskSeq ?? props.seq,
    type: 'action',
    at: props.at,
    text: props.text,
    data: { text: props.text },
    ...(props.eventId ? { eventId: props.eventId } : {}),
  })

  const mockTask = (id: string, gameId = 'game-1'): AgentTask => ({
    id,
    goal: 'Test goal',
    gameId,
    conversationId: 'conv-1',
    profileId: 'prof-1',
    model: 'model-1',
    persistence: 'durable',
    runtimeInstanceId: 'inst-1',
    capability: 'play',
    state: 'running',
    lastSeq: 0,
    createdAt: 1000,
    updatedAt: 1000,
    events: [],
    messages: [],
  })

  it('appends events incrementally and reads task with events in order', async () => {
    const task = mockTask('task-1')
    const event1 = testEvent({ seq: 1, taskSeq: 1, at: 1001, text: 'First event' })
    const event2 = testEvent({ seq: 2, taskSeq: 2, at: 1002, text: 'Second event' })

    await store.append(task, event1)
    await store.append(task, event2)

    const loaded = await store.read('task-1')
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('task-1')
    expect(loaded!.events).toHaveLength(2)
    expect((loaded!.events[0] as TestTraceEvent).text).toBe('First event')
    expect((loaded!.events[1] as TestTraceEvent).text).toBe('Second event')
  })

  it('idempotently handles identical event re-send without duplicate counting', async () => {
    const task = mockTask('task-dup')
    const event = testEvent({ seq: 1, taskSeq: 1, eventId: 'evt-unique-1', at: 1000, text: 'Action' })

    await store.append(task, event)
    // Resend same event
    await store.append(task, event)

    const loaded = await store.read('task-dup')
    expect(loaded!.events).toHaveLength(1)
  })

  it('rejects conflicting event with same key but different content (A01)', async () => {
    const task = mockTask('task-conflict')
    const event1 = testEvent({ seq: 1, taskSeq: 1, eventId: 'evt-c-1', at: 1000, text: 'Original text' })
    const event2 = testEvent({ seq: 1, taskSeq: 1, eventId: 'evt-c-1', at: 1000, text: 'Conflicting text' })

    await store.append(task, event1)
    await expect(store.append(task, event2)).rejects.toThrow(AgentTraceConflictError)
  })

  it('supports source events linking to multiple targets and tasks (A02)', async () => {
    const sourceEvent: SourceGameEvent = {
      schemaVersion: 2,
      eventId: 'src-evt-1',
      type: 'game.scene',
      taskSeq: 1,
      at: 2000,
      producer: { id: 'test', kind: 'game_plugin', epoch: 1, sourceSeq: 1 },
      execution: { host: 'game_plugin', component: 'test' },
      classification: { domain: 'game_runtime', type: 'test', effect: 'read' },
      targets: [
        { kind: 'game', id: 'game-1', libraryGameId: 'game-1', runtimeInstanceId: 'inst-1' },
        { kind: 'game', id: 'game-1', libraryGameId: 'game-1', runtimeInstanceId: 'inst-2' },
      ],
      correlation: { taskId: 'task-linked' },
    }

    await store.appendSource(sourceEvent)

    const task = mockTask('task-linked')
    const taskEvent = testEvent({ seq: 2, taskSeq: 1, at: 2001, text: 'Follow-up' })
    await store.append(task, taskEvent)

    const loaded = await store.read('task-linked')
    expect(loaded).not.toBeNull()
    expect(loaded!.events).toHaveLength(2)
    expect(loaded!.events.map((e) => e.eventId || (e as TestTraceEvent).text)).toContain('src-evt-1')
  })

  it('paginates task list and task events with stable keyset cursors', async () => {
    for (let i = 1; i <= 5; i++) {
      const t = mockTask(`task-page-${i}`)
      t.updatedAt = 1000 + i
      await store.append(t, testEvent({ seq: 1, taskSeq: 1, at: t.updatedAt, text: `E${i}` }))
    }

    const page1 = await store.listPage({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()
    expect(page1.total).toBe(5)

    const page2 = await store.listPage({ limit: 2, cursor: page1.nextCursor! })
    expect(page2.items).toHaveLength(2)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)
    expect(page2.items[0].id).not.toBe(page1.items[1].id)

    const page3 = await store.listPage({ limit: 2, cursor: page2.nextCursor! })
    expect(page3.items).toHaveLength(1)
    expect(page3.nextCursor).toBeNull()

    // Read page for events
    const targetTask = mockTask('task-multievent')
    for (let j = 1; j <= 5; j++) {
      await store.append(targetTask, testEvent({ seq: j, taskSeq: j, at: 3000 + j, text: `Step ${j}` }))
    }

    const evPage1 = await store.readPage('task-multievent', { limit: 3 })
    expect(evPage1!.events).toHaveLength(3)
    expect(evPage1!.nextCursor).not.toBeNull()

    const evPage2 = await store.readPage('task-multievent', { limit: 3, cursor: evPage1!.nextCursor! })
    expect(evPage2!.events).toHaveLength(2)
    expect(evPage2!.nextCursor).toBeNull()
  })

  it('exports task and events in standard v2 JSONL envelope format', async () => {
    const task = mockTask('task-export')
    await store.append(task, testEvent({ seq: 1, taskSeq: 1, at: 1000, text: 'Action 1' }))
    await store.append(task, testEvent({ seq: 2, taskSeq: 2, at: 1001, text: 'Action 2' }))

    const exp = await store.export('task-export')
    expect(exp).not.toBeNull()
    expect(exp!.filename).toBe('agent-trace-task-export.jsonl')
    expect(exp!.mimeType).toBe('application/x-ndjson')

    const lines = exp!.content
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines[0].version).toBe(2)
    expect(lines[0].kind).toBe('task')
    expect(lines[1].version).toBe(2)
    expect(lines[1].kind).toBe('event')
  })
})
