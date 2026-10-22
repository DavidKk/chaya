import type { AgentTask, AgentTaskStore } from '@/lib/game-agent/runtime'

import { tryNodeRequire } from '../../helpers/node/node-require'

const VERSION = 1
const MAX_TASKS = 20
const MAX_AGE_MS = 7 * 24 * 60 * 60_000

type StoredTasks = { version: 1; tasks: AgentTask[] }

function validTask(value: unknown): value is AgentTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Partial<AgentTask>
  return (
    typeof task.id === 'string' &&
    typeof task.gameId === 'string' &&
    typeof task.conversationId === 'string' &&
    ['play', 'ask', 'companion'].includes(String(task.capability)) &&
    typeof task.profileId === 'string' &&
    typeof task.model === 'string' &&
    ['running', 'waiting_user', 'waiting_service', 'completed', 'stopped', 'failed', 'interrupted'].includes(String(task.state)) &&
    typeof task.goal === 'string' &&
    Number.isFinite(task.createdAt) &&
    Number.isFinite(task.updatedAt) &&
    Number.isFinite(task.lastSeq) &&
    Array.isArray(task.events) &&
    Array.isArray(task.messages)
  )
}

function normalize(raw: unknown, now = Date.now()): AgentTask[] {
  if (!raw || typeof raw !== 'object' || (raw as Partial<StoredTasks>).version !== VERSION) return []
  const tasks = (raw as Partial<StoredTasks>).tasks
  if (!Array.isArray(tasks)) return []
  return tasks
    .filter(validTask)
    .filter((task) => now - task.updatedAt <= MAX_AGE_MS)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-MAX_TASKS)
    .map((task) => ({ ...task, events: task.events.slice(-200), messages: task.messages.slice(-40) }))
}

/** Game-side v1 task store. Node games use an atomic file; browser games use localStorage. */
export function createGameAgentTaskStore(gameRoot?: string): AgentTaskStore {
  const req = tryNodeRequire()
  const fs = req && gameRoot ? (req('fs') as typeof import('fs')) : null
  const path = req && gameRoot ? (req('path') as typeof import('path')) : null
  const file = path && gameRoot ? path.join(gameRoot, 'chaya', 'agent', 'tasks.v1.json') : null
  const storageKey = `chaya.agent.tasks.v1:${String(gameRoot || location.pathname)}`
  let queue = Promise.resolve()

  const read = async (): Promise<AgentTask[]> => {
    try {
      if (fs && file) return normalize(JSON.parse(await fs.promises.readFile(file, 'utf8')))
      return normalize(JSON.parse(localStorage.getItem(storageKey) || 'null'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      return []
    }
  }

  const write = async (tasks: AgentTask[], signal: AbortSignal) => {
    if (signal.aborted) throw signal.reason
    const body = JSON.stringify({ version: VERSION, tasks: normalize({ version: VERSION, tasks }) } satisfies StoredTasks)
    if (!fs || !path || !file) {
      localStorage.setItem(storageKey, body)
      return
    }
    const dir = path.dirname(file)
    const temp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await fs.promises.mkdir(dir, { recursive: true })
    if (signal.aborted) throw signal.reason
    try {
      await fs.promises.writeFile(temp, body, { encoding: 'utf8', mode: 0o600 })
      if (signal.aborted) throw signal.reason
      await fs.promises.rename(temp, file)
      await fs.promises.chmod(file, 0o600).catch(() => undefined)
    } finally {
      await fs.promises.unlink(temp).catch(() => undefined)
    }
  }

  const mutate = (change: (tasks: AgentTask[]) => AgentTask[], signal: AbortSignal) => {
    const operation = queue.then(async () => write(change(await read()), signal))
    queue = operation.catch(() => undefined)
    return operation
  }

  return {
    load: read,
    save: (task, signal) =>
      mutate((tasks) => {
        const next = tasks.filter((candidate) => candidate.id !== task.id)
        next.push(task)
        return next
      }, signal),
    remove: (taskId, signal) => mutate((tasks) => tasks.filter((task) => task.id !== taskId), signal),
  }
}

export const gameAgentStoreLimits = { maxTasks: MAX_TASKS, maxAgeMs: MAX_AGE_MS } as const
