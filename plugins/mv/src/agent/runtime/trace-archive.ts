import { browserAgentTraceArchive } from '@/lib/browser/agent-trace-store'
import type { AgentTraceArchive } from '@/lib/game-agent/trace'

import { pluginStorageCall } from '../../helpers/storage/client'

/** All hosting modes persist traces in the local daemon, independently of the console URL. */
export function createGameAgentTraceArchive(gameId: string, runtimeInstanceIdOrCloud?: string | boolean, cloud?: boolean): AgentTraceArchive {
  const isCloud = typeof runtimeInstanceIdOrCloud === 'boolean' ? runtimeInstanceIdOrCloud : Boolean(cloud)
  if (isCloud) return browserAgentTraceArchive
  const runtimeInstanceId = typeof runtimeInstanceIdOrCloud === 'string' ? runtimeInstanceIdOrCloud : undefined
  return {
    async appendSource(event) {
      await pluginStorageCall('trace.source', [event])
    },
    async append(task, event) {
      await pluginStorageCall('trace.append', [task, event])
    },
    list: () => pluginStorageCall('trace.list', [gameId, runtimeInstanceId]),
    read: (taskId) => pluginStorageCall('trace.read', [gameId, taskId, runtimeInstanceId]),
    export: (taskId) => pluginStorageCall('trace.export', [gameId, taskId, runtimeInstanceId]),
    remove: (taskId) => pluginStorageCall('trace.remove', [gameId, taskId, runtimeInstanceId]),
  }
}
