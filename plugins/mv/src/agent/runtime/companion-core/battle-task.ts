import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'
import type { EncounterOutcome } from '@/lib/game-agent/companion/core/types'
import type { AgentTask, AgentTaskController } from '@/lib/game-agent/runtime'

import { battleSupportIssue } from './battle-support'
import { CompanionBattleRuntime, type CompanionRuntimeDeps } from './runtime'

type TaskEvent = { kind: 'paused'; reason: string } | { kind: 'result'; encounterId: string; outcome: EncounterOutcome; turns: number }

export type BattleTaskDeps = Omit<CompanionRuntimeDeps, 'onStatusChange' | 'onEncounterResult' | 'onUnsupported'> & {
  controller: Pick<AgentTaskController, 'emit' | 'waitForUser' | 'stop'>
  onRuntime?: (runtime: CompanionBattleRuntime | null) => void
  onRecord?: (event: BattleRecordEvent) => void
  beforeStart?: (runtime: CompanionBattleRuntime) => Promise<void>
}

/** One trusted task owns the local loop; models can only submit tactic suggestions. */
export async function runBattleTask(task: AgentTask, outerSignal: AbortSignal, deps: BattleTaskDeps): Promise<void> {
  const stopped = new AbortController()
  const signal = AbortSignal.any([outerSignal, stopped.signal])
  signal.throwIfAborted()
  const issue = battleSupportIssue(true)
  if (issue) throw Object.assign(new Error(issue), { code: 'CAPABILITY_UNSUPPORTED' })
  const scope = deps.facts.current().stamp
  let closed = false
  let pauseReason: string | undefined
  let pending: TaskEvent[] = []
  let wake: ((event: TaskEvent) => void) | undefined
  const stop = () => {
    if (closed || signal.aborted) return
    deps.controller.stop(task.id)
    stopped.abort(new DOMException('Battle control stopped', 'AbortError'))
  }
  const publish = (event: TaskEvent) => {
    if (closed || signal.aborted) return
    if (wake) {
      const resolve = wake
      wake = undefined
      resolve(event)
    } else if (pending.length < 8) pending.push(event)
  }
  const battle = new CompanionBattleRuntime({
    ...deps,
    onDiagnostic: (diagnostic) => {
      if (!closed && !signal.aborted) deps.controller.emit(task.id, 'progress.updated', { executor: 'local_battle', diagnostic })
    },
    checkSupport: () => battleSupportIssue(),
    onStatusChange(status) {
      deps.controller.emit(task.id, 'progress.updated', { executor: 'local_battle', status })
      if (status === 'paused') publish({ kind: 'paused', reason: pauseReason ?? '战斗操作结果不明或现场已变化，已暂停自动输入。' })
      if (status === 'idle') stop()
    },
    onUnsupported(reason) {
      pauseReason = reason
    },
    onEncounterResult(encounterId, outcome, turns) {
      publish({ kind: 'result', encounterId, outcome, turns })
    },
  })
  const abort = () => battle.stop()
  signal.addEventListener('abort', abort, { once: true })
  const unsubscribe = deps.facts.subscribe((event) => {
    const current = deps.facts.current().stamp
    if ((event.kind === 'load' && event.phase === 'begin') || current.contextEpoch !== scope.contextEpoch || JSON.stringify(current.scope) !== JSON.stringify(scope.scope)) {
      if (battle.getStatus() === 'idle') stop()
      else battle.stop()
    }
  })
  const next = (): Promise<TaskEvent> => {
    signal.throwIfAborted()
    const queued = pending.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const cancel = () => {
        wake = undefined
        reject(signal.reason)
      }
      signal.addEventListener('abort', cancel, { once: true })
      wake = (event) => {
        signal.removeEventListener('abort', cancel)
        resolve(event)
      }
    })
  }
  try {
    deps.onRuntime?.(battle)
    await deps.beforeStart?.(battle)
    signal.throwIfAborted()
    battle.start(task.id)
    battle.tick()
    for (;;) {
      const event = await next()
      signal.throwIfAborted()
      if (event.kind === 'result') {
        const current = deps.facts.current().stamp
        if (current.contextEpoch !== scope.contextEpoch || JSON.stringify(current.scope) !== JSON.stringify(scope.scope)) continue
        deps.controller.emit(task.id, 'progress.updated', { executor: 'local_battle', ...event })
        if (event.outcome === 'win' || event.outcome === 'escape') {
          if (task.lifetime === 'until_stopped') continue
          deps.controller.emit(task.id, 'assistant.completed', { text: event.outcome === 'win' ? '这场战斗结束了。' : '已脱离这场战斗。', reason: 'answered' })
          return
        }
      }
      battle.pause()
      const question = event.kind === 'paused' ? event.reason : '战斗已结束，但未获胜。请确认是否继续接管当前战斗。'
      const answer = await deps.controller.waitForUser(task.id, question, signal, {
        kind: 'choice',
        text: question,
        tone: 'warn',
        options: [
          { id: 'resume_battle', label: '继续当前战斗' },
          { id: 'stop_battle', label: '停止托管' },
        ],
      })
      signal.throwIfAborted()
      if (answer !== 'resume_battle') {
        deps.controller.stop(task.id)
        signal.throwIfAborted()
        return
      }
      await battle.whenIdle()
      signal.throwIfAborted()
      const current = deps.facts.current().stamp
      if (current.contextEpoch !== scope.contextEpoch || JSON.stringify(current.scope) !== JSON.stringify(scope.scope)) throw new Error('现场已变化，请重新发起战斗请求')
      const unsupported = battleSupportIssue(true)
      if (unsupported) throw Object.assign(new Error(unsupported), { code: 'CAPABILITY_UNSUPPORTED' })
      pending = []
      pauseReason = undefined
      battle.start(task.id)
      battle.tick()
    }
  } catch (error) {
    if (!stopped.signal.aborted) throw error
  } finally {
    closed = true
    signal.removeEventListener('abort', abort)
    unsubscribe()
    battle.dispose()
    deps.onRuntime?.(null)
  }
}
