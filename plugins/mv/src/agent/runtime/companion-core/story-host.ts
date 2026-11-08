import type { AgentTask, AgentTaskController } from '@/lib/game-agent/runtime'
import type { AgentSyncSettings } from '@/lib/game-agent/settings-sync'

import type { CompanionComplete } from '../companion-chat'
import { profileOf, readConfig } from '../host'
import { installStoryFailureJournal } from './story-failure-journal'
import { CompanionStoryRuntime, type StoryProgressUpdate } from './story-runtime'

export type StoryHostDeps = {
  runtimeInstanceId: string
  controller: Pick<AgentTaskController, 'emit' | 'stop'>
  complete: CompanionComplete
  readConfig?: () => AgentSyncSettings | null
}

export function createStoryHost(deps: StoryHostDeps) {
  installStoryFailureJournal()
  let activeRuntime: CompanionStoryRuntime | null = null

  return {
    getActiveRuntime(): CompanionStoryRuntime | null {
      return activeRuntime
    },
    async execute(task: AgentTask, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted()

      const config = (deps.readConfig || readConfig)()
      const profile = config ? profileOf(config, task.profileId) : null
      const effectiveProfileId = profile?.id || task.profileId || ''
      const effectiveModel = task.model || profile?.defaultModel || ''

      if (deps.complete.ensureReady && effectiveProfileId && effectiveModel) {
        void deps.complete
          .ensureReady({
            profileId: effectiveProfileId,
            model: effectiveModel,
            signal,
            conversationKey: JSON.stringify(['warmup', deps.runtimeInstanceId, task.id]),
            onModelStatus: (modelStatus) => {
              if (modelStatus.phase === 'loading') {
                deps.controller.emit(task.id, 'progress.updated', {
                  executor: 'story_custody',
                  modelStatus,
                  summary: '模型冷启动加载中…',
                })
              }
            },
          })
          .catch((err) => {
            console.warn('[story-host] Background warmup failed:', err)
          })
      }

      const runtime = new CompanionStoryRuntime({
        complete: deps.complete,
        profileId: effectiveProfileId,
        model: effectiveModel,
        character: (task as any).character || (task as any).companionCharacter,
        locale: task.locale,
        goal: task.goal,
        signal,
        onGameover: () => {
          deps.controller.stop(task.id)
        },
        onThought: (thought) => {
          deps.controller.emit(task.id, 'model.thought', thought as Record<string, unknown>)
        },
        onProgress: (update: StoryProgressUpdate) => {
          if (update.phase === 'thought' && update.detail) {
            deps.controller.emit(task.id, 'model.thought', update.detail as Record<string, unknown>)
            return
          }
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
          summary: '托管已启动，自律推进中…',
        })
        await runtime.start()
        if (!signal.aborted) deps.controller.stop(task.id)
      } finally {
        signal.removeEventListener('abort', onAbort)
        runtime.stop()
        if (activeRuntime === runtime) activeRuntime = null
      }
    },
  }
}
