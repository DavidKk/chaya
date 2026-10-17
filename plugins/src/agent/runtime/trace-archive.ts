import { browserAgentTraceArchive } from '@/lib/browser/agent-trace-store'
import type { AgentTask } from '@/lib/game-agent/runtime'
import type { AgentTraceArchive, AgentTraceExport, AgentTraceSummary } from '@/lib/game-agent/trace'

import { chayaFetch } from '../../helpers'

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message || `Agent 轨迹文件请求失败：HTTP ${response.status}`)
  return body
}

function cloudRuntime() {
  return typeof window !== 'undefined' && Boolean((window as Window & { CHAYA_LINK_TOKEN?: string }).CHAYA_LINK_TOKEN)
}

/** Cloud games archive in their browser database; locally launched games delegate to the service file store. */
export function createGameAgentTraceArchive(gameId: string, runtimeInstanceIdOrCloud?: string | boolean, cloud = cloudRuntime()): AgentTraceArchive {
  const runtimeInstanceId = typeof runtimeInstanceIdOrCloud === 'string' ? runtimeInstanceIdOrCloud : undefined
  const useCloud = typeof runtimeInstanceIdOrCloud === 'boolean' ? runtimeInstanceIdOrCloud : cloud
  if (useCloud) return browserAgentTraceArchive
  let queue = Promise.resolve()
  const query = (taskId?: string, format?: 'jsonl') => {
    const search = new URLSearchParams({ gameId, ...(runtimeInstanceId ? { runtimeInstanceId } : {}) })
    if (taskId) search.set('taskId', taskId)
    if (format) search.set('format', format)
    return `/api/game-agent/activity?${search}`
  }
  return {
    appendSource(sourceEvent) {
      const operation = queue.then(async () => {
        await json(
          await chayaFetch('/api/game-agent/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceEvent }),
          })
        )
      })
      queue = operation.catch(() => undefined)
      return operation
    },
    append(task, event) {
      const snapshot: AgentTask = { ...task, events: [], messages: [] }
      const operation = queue.then(async () => {
        await json(
          await chayaFetch('/api/game-agent/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: snapshot, event }),
          })
        )
      })
      queue = operation.catch(() => undefined)
      return operation
    },
    async list() {
      return (await json<{ tasks?: AgentTraceSummary[] }>(await chayaFetch(query()))).tasks || []
    },
    async read(taskId) {
      return (await json<{ task?: AgentTask }>(await chayaFetch(query(taskId)))).task || null
    },
    async export(taskId) {
      const response = await chayaFetch(query(taskId, 'jsonl'))
      if (response.status === 404) return null
      if (!response.ok) await json(response)
      const disposition = response.headers.get('Content-Disposition') || ''
      return {
        filename: disposition.match(/filename="?([^";]+)"?/i)?.[1] || `agent-trace-${taskId}.jsonl`,
        mimeType: 'application/x-ndjson',
        content: await response.text(),
      } satisfies AgentTraceExport
    },
    async remove(taskId) {
      return (await json<{ removed?: number }>(await chayaFetch(query(taskId), { method: 'DELETE' }))).removed || 0
    },
  }
}
