import fs from 'node:fs'
import path from 'node:path'

import { AGENT_ACTIVITY_LOGS_DIR, GAME_ACTIVITY_LOGS_DIR } from '@/constants/paths'
import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import {
  type AgentTraceArchive,
  AgentTraceConflictError,
  type AgentTraceSummary,
  sameTraceEvent,
  traceCleanupIds,
  traceEventKey,
  traceExport,
  traceSummary,
} from '@/lib/game-agent/trace'

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
const safe = (id: string) => {
  const value = id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160)
  return !value || value === '.' || value === '..' ? '_' : value
}

export type AgentTraceFileStore = AgentTraceArchive & {
  appendSource(event: SourceGameEvent): Promise<void>
  removeForGame(gameId: string, taskId?: string): Promise<number>
  removeForRuntime(runtimeInstanceId: string, taskId?: string, gameId?: string): Promise<number>
  directory: string
}

/** File-backed source of truth for Agent activity. Runtime memory is never used as an archive. */
export function createAgentTraceFileStore(directory = AGENT_ACTIVITY_LOGS_DIR, gameDirectory = GAME_ACTIVITY_LOGS_DIR): AgentTraceFileStore {
  let queue = Promise.resolve()
  const gameActivityDirectory = gameDirectory || directory
  const summaryFile = (id: string) => path.join(directory, `${safe(id)}.summary.json`)
  const eventsFile = (id: string) => path.join(directory, `${safe(id)}.events.jsonl`)
  const sourceEventsFile = (task: Pick<AgentTask, 'gameId' | 'libraryGameId' | 'runtimeInstanceId'>) =>
    path.join(gameActivityDirectory, safe(task.libraryGameId || task.gameId), safe(task.runtimeInstanceId || task.gameId), 'events.jsonl')
  const standaloneSourceFile = (event: SourceGameEvent) => {
    const target = event.targets.find((item) => item.runtimeInstanceId)
    if (!target?.runtimeInstanceId) throw new Error('Game source event missing runtime instance')
    return path.join(gameActivityDirectory, safe(target.libraryGameId || target.runtimeInstanceId), safe(target.runtimeInstanceId), 'events.jsonl')
  }
  const readSummary = async (file: string): Promise<AgentTraceSummary | null> => {
    try {
      return JSON.parse(await fs.promises.readFile(file, 'utf8')) as AgentTraceSummary
    } catch {
      return null
    }
  }
  const list = async () => {
    const names = await fs.promises.readdir(directory).catch(() => [])
    const summaries = await Promise.all(names.filter((name) => name.endsWith('.summary.json')).map((name) => readSummary(path.join(directory, name))))
    return summaries.filter((item): item is AgentTraceSummary => !!item).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  const removeFiles = async (id: string) => {
    await Promise.all([fs.promises.unlink(summaryFile(id)).catch(() => undefined), fs.promises.unlink(eventsFile(id)).catch(() => undefined)])
  }
  const cleanup = async () => {
    for (const id of traceCleanupIds(await list())) await removeFiles(id)
  }
  const read = async (taskId: string) => {
    const summary = await readSummary(summaryFile(taskId))
    if (!summary) return null
    const body = await fs.promises.readFile(eventsFile(taskId), 'utf8').catch(() => '')
    const taskEvents = body
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AgentTaskEvent]
        } catch {
          return []
        }
      })
    const sourceBody = await fs.promises.readFile(sourceEventsFile(summary), 'utf8').catch(() => '')
    const sourceEvents = sourceBody
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line) as AgentTaskEvent
          return event.correlation?.taskId === taskId ? [event] : []
        } catch {
          return []
        }
      })
    return { ...summary, events: [...taskEvents, ...sourceEvents].sort((a, b) => a.seq - b.seq), messages: [] } as AgentTask
  }
  const readLines = async (file: string): Promise<AgentTaskEvent[]> => {
    const body = await fs.promises.readFile(file, 'utf8').catch(() => '')
    return body
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AgentTaskEvent]
        } catch {
          return []
        }
      })
  }
  const removeMatching = async (gameId?: string, taskId?: string, runtimeInstanceId?: string) => {
    const summaries = await list()
    const ids = summaries
      .filter((item) => (!gameId || item.gameId === gameId) && (!runtimeInstanceId || item.runtimeInstanceId === runtimeInstanceId) && (!taskId || item.id === taskId))
      .map((item) => item.id)
    for (const id of ids) await removeFiles(id)
    return ids.length
  }
  return {
    directory,
    appendSource(event) {
      const operation = queue.then(async () => {
        const file = standaloneSourceFile(event)
        await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
        const existing = (await readLines(file)).find((item) => item.eventId === event.eventId)
        if (existing) {
          if (sameTraceEvent(existing, event)) return
          throw new AgentTraceConflictError(event.eventId)
        }
        await fs.promises.appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
      })
      queue = operation.catch(() => undefined)
      return operation
    },
    append(task, event) {
      const operation = queue.then(async () => {
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
        const previous = await readSummary(summaryFile(task.id))
        const file = event.producer?.kind === 'game_plugin' ? sourceEventsFile(task) : eventsFile(task.id)
        await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
        const existing = (await readLines(file)).find((item) => traceEventKey(task.id, item) === traceEventKey(task.id, event))
        if (existing) {
          if (sameTraceEvent(existing, event)) return
          throw new AgentTraceConflictError(traceEventKey(task.id, event))
        }
        const line = `${JSON.stringify(event)}\n`
        await fs.promises.appendFile(file, line, { encoding: 'utf8', mode: 0o600 })
        const summary = traceSummary(task, (previous?.eventCount || 0) + 1, (previous?.sizeBytes || 0) + bytes(line))
        const temp = `${summaryFile(task.id)}.${process.pid}.${Date.now()}.tmp`
        await fs.promises.writeFile(temp, JSON.stringify(summary), { encoding: 'utf8', mode: 0o600 })
        await fs.promises.rename(temp, summaryFile(task.id))
        if (['completed', 'stopped', 'failed', 'interrupted'].includes(task.state)) await cleanup()
      })
      queue = operation.catch(() => undefined)
      return operation
    },
    list,
    read,
    async export(taskId) {
      const task = await read(taskId)
      return task ? traceExport(task) : null
    },
    remove: (taskId) => removeMatching(undefined, taskId),
    removeForGame: (gameId, taskId) => removeMatching(gameId, taskId),
    removeForRuntime: (runtimeInstanceId, taskId, gameId) => removeMatching(gameId, taskId, runtimeInstanceId),
  }
}

export const agentTraceFileStore = createAgentTraceFileStore()
