import type { AgentTask } from '@/lib/game-agent/runtime'

import type { CompanionComplete } from '../companion-chat'
import type { CompanionMemoryRuntime } from '../memory-persistence'
import { createBattleDecisions } from './battle-decisions'
import { BATTLE_INTENT_FORMAT, BATTLE_INTENT_SYSTEM, createBattleIntents } from './battle-intents'
import { type BattleTaskDeps, runBattleTask } from './battle-task'
import type { CompanionBattleRuntime } from './runtime'

export function createBattleHost(
  deps: Omit<BattleTaskDeps, 'onRuntime' | 'onRequestDecision' | 'onRecord' | 'getDecisionVersions'> & {
    complete: CompanionComplete
    memory: CompanionMemoryRuntime
  }
) {
  let active: CompanionBattleRuntime | null = null
  let intents: ReturnType<typeof createBattleIntents> | null = null
  return {
    beginIntent(sourceId: string, prompt: string) {
      return intents?.begin(sourceId, prompt) ?? null
    },
    async execute(task: AgentTask, signal: AbortSignal): Promise<void> {
      await deps.memory.ready()
      signal.throwIfAborted()
      let runtime: CompanionBattleRuntime | null = null
      const decisions = createBattleDecisions({
        task,
        signal,
        complete: deps.complete,
        memory: deps.memory.store,
        getRuntime: () => runtime,
        onResult: (result) => deps.controller.emit(task.id, 'progress.updated', { executor: 'local_battle', decision: result }),
      })
      try {
        await runBattleTask(task, signal, {
          ...deps,
          onRequestDecision: (ticket) => decisions.request(ticket),
          getDecisionVersions: () => ({ memoryEpoch: deps.memory.store.getEpoch(), recordingRevision: deps.memory.store.getRecordingRevision() }),
          onRecord: (event) => {
            deps.memory.recording.enqueue(event)
          },
          onRuntime: (value) => {
            if (!value && active === runtime) {
              active = null
              intents = null
            }
            runtime = value
            if (value) {
              active = value
              intents = createBattleIntents({ runtime: value, currentFacts: () => deps.facts.current(), signal })
            }
          },
          beforeStart: async () => {
            await deps.complete.ensureReady?.({
              profileId: task.profileId,
              model: task.model,
              signal,
              conversationKey: JSON.stringify(['warmup', deps.runtimeInstanceId, task.id]),
              onModelStatus: (modelStatus) =>
                deps.controller.emit(task.id, 'progress.updated', {
                  executor: 'local_battle',
                  modelStatus,
                  summary:
                    modelStatus.phase === 'loading'
                      ? '模型需要冷启动，正在加载，首次使用可能较慢…'
                      : modelStatus.residency === 'unknown'
                        ? '正在连接模型，准备战斗…'
                        : '模型已就绪，正在准备战斗',
                }),
            })
            signal.throwIfAborted()
            const receipt = intents?.begin(task.id, task.goal, true)
            if (!receipt) throw new Error('无法校验战斗目标，请重新发起请求')
            const reply = await deps.complete(
              [
                { role: 'system', content: `${BATTLE_INTENT_SYSTEM} Return the battleIntent object itself as JSON, with no other fields.` },
                { role: 'user', content: JSON.stringify({ prompt: task.goal, battleIntentContext: receipt.context }) },
              ],
              {
                profileId: task.profileId,
                model: task.model,
                purpose: 'route',
                signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
                format: BATTLE_INTENT_FORMAT as unknown as Record<string, unknown>,
                conversationKey: JSON.stringify(['intent', deps.runtimeInstanceId, task.profileId, task.model, task.id]),
              }
            )
            signal.throwIfAborted()
            const result = receipt.accept(
              JSON.parse(
                reply.content
                  .trim()
                  .replace(/^```(?:json)?\s*/i, '')
                  .replace(/\s*```$/, '')
              )
            )
            if (result === 'clarify' || result === 'stale') throw new Error('战斗要求暂时无法准确应用，请明确技能、敌人或保留的 MP 数量后重试')
          },
        })
      } finally {
        decisions.close()
      }
    },
    chatContext(): unknown {
      if (!active) return undefined
      const command = active.coordinator.getCurrentAction()
      return {
        status: active.getStatus(),
        tacticRevision: active.getTacticPlan().revision,
        rules: active
          .getTacticPlan()
          .rules.slice(0, 8)
          .map((rule) => ({ id: rule.id, reason: rule.reason, when: rule.when, prefer: rule.prefer })),
        action: command ? { kind: command.intent.actionOffer.kind, name: command.intent.actionOffer.name, reason: command.intent.reason, lifecycle: command.lifecycle } : null,
      }
    },
  }
}
