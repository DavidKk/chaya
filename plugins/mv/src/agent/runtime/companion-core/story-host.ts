import type { AgentTask, AgentTaskController } from '@/lib/game-agent/runtime'

import type { CompanionComplete } from '../companion-chat'
import { CompanionStoryRuntime, type StoryProgressUpdate } from './story-runtime'

export type StoryHostDeps = {
  runtimeInstanceId: string
  controller: Pick<AgentTaskController, 'emit' | 'stop'>
  complete: CompanionComplete
}

export function createStoryHost(deps: StoryHostDeps) {
  let activeRuntime: CompanionStoryRuntime | null = null

  return {
    getActiveRuntime(): CompanionStoryRuntime | null {
      return activeRuntime
    },
    async execute(task: AgentTask, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted()

      await deps.complete.ensureReady?.({
        profileId: task.profileId,
        model: task.model,
        signal,
        conversationKey: JSON.stringify(['warmup', deps.runtimeInstanceId, task.id]),
        onModelStatus: (modelStatus) =>
          deps.controller.emit(task.id, 'progress.updated', {
            executor: 'story_custody',
            modelStatus,
            summary:
              modelStatus.phase === 'loading'
                ? '模型冷启动加载中…'
                : '模型已就绪，正在准备全托管剧情…',
          }),
      })

      signal.throwIfAborted()

      const runtime = new CompanionStoryRuntime({
        complete: deps.complete,
        profileId: task.profileId,
        model: task.model,
        signal,
        onProgress: (update: StoryProgressUpdate) => {
          deps.controller.emit(task.id, 'progress.updated', {
            executor: 'story_custody',
            phase: update.phase,
            summary: update.summary,
            detail: update.detail,
          })
        },
      })

      activeRuntime = runtime
      const onAbort = () => {
        runtime.stop()
        if (activeRuntime === runtime) activeRuntime = null
      }
      signal.addEventListener('abort', onAbort, { once: true })

      try {
        deps.controller.emit(task.id, 'progress.updated', {
          executor: 'story_custody',
          phase: 'exploring',
          summary: '全托管剧情已启动，自律推进中…',
        })
        await runtime.start()
      } finally {
        signal.removeEventListener('abort', onAbort)
        runtime.stop()
        if (activeRuntime === runtime) activeRuntime = null
      }
    },
  }
}
