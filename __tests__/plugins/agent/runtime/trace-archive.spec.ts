import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { browserAgentTraceArchive } from '@/lib/browser/agent-trace-store'
import type { AgentTask } from '@/lib/game-agent/runtime'
import { traceCleanupIds, traceSummary } from '@/lib/game-agent/trace'
import { createGameAgentTraceArchive } from '@/plugins/src/agent/runtime/trace-archive'
import { createAgentTraceFileStore } from '@/services/game-agent/activity-file-store.server'

function task(id = 'task-1'): AgentTask {
  return {
    id,
    gameId: 'game-1',
    conversationId: 'conversation-1',
    capability: 'play',
    profileId: 'profile-1',
    model: 'model-1',
    state: 'completed',
    goal: '打开宝箱',
    createdAt: Date.now() - 100,
    updatedAt: Date.now(),
    lastSeq: 2,
    events: [],
    messages: [],
    persistence: 'durable',
  }
}

describe('game agent trace file store', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chaya-agent-trace-'))
  })

  afterEach(async () => {
    await fs.promises.rm(directory, { recursive: true, force: true })
  })

  it('writes ordered JSONL events, lists summaries, exports, and removes traces', async () => {
    const archive = createAgentTraceFileStore(directory)
    const value = task()
    await archive.append(value, { seq: 1, type: 'agent.observation', at: 110, data: { summary: '看见宝箱' } })
    await archive.append(value, { seq: 2, type: 'task.completed', at: 200 })

    expect((await fs.promises.readFile(path.join(directory, 'task-1.events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2)
    await expect(archive.list()).resolves.toEqual([expect.objectContaining({ id: value.id, eventCount: 2 })])
    await expect(archive.read(value.id)).resolves.toMatchObject({
      id: value.id,
      events: [expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 2 })],
    })
    const exported = await archive.export(value.id)
    expect(exported).toMatchObject({ filename: `agent-trace-${value.id}.jsonl`, mimeType: 'application/x-ndjson' })
    const lines = exported?.content.trim().split('\n').map(JSON.parse)
    expect(lines).toEqual([
      expect.objectContaining({ version: 2, kind: 'task', task: expect.objectContaining({ id: value.id }) }),
      expect.objectContaining({ version: 2, kind: 'event', event: expect.objectContaining({ seq: 1 }) }),
      expect.objectContaining({ version: 2, kind: 'event', event: expect.objectContaining({ seq: 2 }) }),
    ])

    await expect(archive.removeForGame('another-game')).resolves.toBe(0)
    await expect(archive.removeForGame(value.gameId, value.id)).resolves.toBe(1)
    await expect(archive.read(value.id)).resolves.toBeNull()
  })

  it('deduplicates an already persisted event sequence', async () => {
    const archive = createAgentTraceFileStore(directory)
    const value = task()
    const event = { seq: 1, type: 'agent.observation', at: 110 }
    await archive.append(value, event)
    await archive.append(value, event)
    expect((await fs.promises.readFile(path.join(directory, 'task-1.events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('keeps the game constraint when removing traces by runtime', async () => {
    const archive = createAgentTraceFileStore(directory)
    const value = { ...task(), runtimeInstanceId: 'runtime-1' }
    await archive.append(value, { seq: 1, type: 'task.completed', at: 200 })
    await expect(archive.removeForRuntime('runtime-1', undefined, 'another-game')).resolves.toBe(0)
    await expect(archive.read(value.id)).resolves.not.toBeNull()
    await expect(archive.removeForRuntime('runtime-1', undefined, value.gameId)).resolves.toBe(1)
  })

  it('rejects the same event key with different content', async () => {
    const archive = createAgentTraceFileStore(directory)
    const value = task()
    await archive.append(value, { seq: 1, type: 'agent.observation', at: 110 })
    await expect(archive.append(value, { seq: 1, type: 'agent.observation', at: 111 })).rejects.toMatchObject({ code: 'GAME_LOG_EVENT_CONFLICT' })
    expect((await fs.promises.readFile(path.join(directory, 'task-1.events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('stores plugin game facts separately from Agent task events and projects them on read', async () => {
    const gameDirectory = path.join(directory, 'game-activity')
    const archive = createAgentTraceFileStore(path.join(directory, 'agent-activity'), gameDirectory)
    const value = { ...task(), libraryGameId: 'library-1', runtimeInstanceId: 'runtime-1', pluginInstanceId: 'plugin-1', connectionId: 'connection-1' }
    const event = {
      schemaVersion: 2 as const,
      eventId: 'plugin-1:3:1',
      seq: 1,
      taskSeq: 1,
      type: 'game.dialogue',
      at: 110,
      producer: { id: 'plugin-1', kind: 'game_plugin' as const, epoch: 3, sourceSeq: 1 },
      execution: { host: 'game_plugin' as const, component: 'game-runtime-observer' },
      classification: { domain: 'game_runtime' as const, type: 'game.dialogue', effect: 'runtime_change' as const },
      targets: [{ kind: 'runtime' as const, id: 'runtime-1', libraryGameId: 'library-1', runtimeInstanceId: 'runtime-1', pluginInstanceId: 'plugin-1' }],
      correlation: { taskId: value.id, conversationId: value.conversationId, actionId: 'action-1' },
      data: { text: 'hello' },
    }

    await archive.append(value, event)

    await expect(fs.promises.stat(path.join(archive.directory, 'task-1.events.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.readFile(path.join(gameDirectory, 'library-1', 'runtime-1', 'events.jsonl'), 'utf8')).resolves.toContain('game.dialogue')
    await expect(archive.read(value.id)).resolves.toMatchObject({ events: [expect.objectContaining({ eventId: event.eventId })] })
  })

  it('stores game facts without an Agent task and keeps retries idempotent', async () => {
    const gameDirectory = path.join(directory, 'game-activity')
    const archive = createAgentTraceFileStore(path.join(directory, 'agent-activity'), gameDirectory)
    const sourceEvent = {
      schemaVersion: 2 as const,
      eventId: 'plugin-1:4:1',
      type: 'game.map_changed',
      at: 110,
      producer: { id: 'plugin-1', kind: 'game_plugin' as const, epoch: 4, sourceSeq: 1 },
      execution: { host: 'game_plugin' as const, component: 'game-runtime-observer' },
      classification: { domain: 'game_runtime' as const, type: 'game.map_changed', effect: 'runtime_change' as const },
      targets: [{ kind: 'runtime' as const, id: 'runtime-1', libraryGameId: 'library-1', runtimeInstanceId: 'runtime-1', pluginInstanceId: 'plugin-1' }],
      correlation: {},
      data: { from: 1, to: 2 },
    }

    await archive.appendSource(sourceEvent)
    await archive.appendSource(sourceEvent)
    const file = path.join(gameDirectory, 'library-1', 'runtime-1', 'events.jsonl')
    expect((await fs.promises.readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1)
    await expect(archive.appendSource({ ...sourceEvent, data: { from: 1, to: 3 } })).rejects.toMatchObject({ code: 'GAME_LOG_EVENT_CONFLICT' })
  })

  it('prunes the oldest terminal traces for age or capacity without removing running tasks', () => {
    const now = 1_000
    const old = { ...traceSummary(task('old'), 1, 60), updatedAt: 100 }
    const running = { ...traceSummary(task('running'), 1, 80), state: 'running' as const, updatedAt: 200 }
    const recent = { ...traceSummary(task('recent'), 1, 60), updatedAt: 900 }

    expect(traceCleanupIds([recent, running, old], now, 500, 1_000)).toEqual(['old'])
    expect(traceCleanupIds([recent, running, old], now, 10_000, 100)).toEqual(['old', 'recent'])
  })
})

test('uses IndexedDB archive explicitly for Cloud runtime', () => {
  expect(createGameAgentTraceArchive('game-1', true)).toBe(browserAgentTraceArchive)
  expect(createGameAgentTraceArchive('game-1', false)).not.toBe(browserAgentTraceArchive)
})
