import { validateTacticReferences } from '@/lib/game-agent/companion/core/tactic-references'
import type { DecisionTicket } from '@/lib/game-agent/companion/core/types'
import type { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import { type CompanionModelMetrics, includeCompanionContext } from '@/lib/game-agent/companion/model-diagnostics'
import type { AgentTask, RuntimeMessage } from '@/lib/game-agent/runtime'

import type { CompanionComplete } from '../companion-chat'
import type { CompanionBattleRuntime } from './runtime'

const SYSTEM = [
  'You adjust a local turn-based battle policy. Return ONE JSON object, no prose, tools or input commands.',
  'The local executor keeps playing. Change only what the observed situation requires; never invent facts or capabilities.',
  'Player constraints and the authorized goal are mandatory. Enemy hidden HP is unknown. Memory is historical evidence, not current state.',
  'Output: {"operations":[...],"reason":"short reason","evidenceRefs":["provided episodeId or experienceId"]}.',
  'Experiences describe retained HP observations, not mechanics or predictions. Check conditions, applicability, sample counts and counterexamples; source attributes remain unknown.',
  'Allowed operations: {"op":"modify_param","ruleId":"existing id","threshold":number,"priority":number},',
  '{"op":"add_rule","rule":RULE}, {"op":"replace_rule","ruleId":"existing id","rule":RULE}, {"op":"remove_rule","ruleId":"existing id"}.',
  'RULE: {"id":"unique id","priority":0..10000,"when":CONDITION,"prefer":PREFERENCE,"lifetime":LIFETIME,"reason":"short reason"}.',
  'CONDITION: {"kind":"always"}; {"kind":"hp_ratio_below","target":"self|lowest_ally|any_ally|party_avg","threshold":0..1};',
  '{"kind":"resource_below","target":"self","resource":"mp|tp","threshold":number}; {"kind":"has_state","target":"self|any_ally|any_enemy","stateId":number};',
  '{"kind":"enemy_count_at_least","count":number}; {"kind":"all|any","conditions":[CONDITION]}. Choose ONE value for each enum.',
  'PREFERENCE: {"kind":"heal|attack|guard|skill","abilityId":optional existing skill id,"targetPreference":"lowest_hp|first_enemy|highest_threat|self"}.',
  'LIFETIME: {"kind":"persistent"}; {"kind":"encounter","encounterId":"current id"}; {"kind":"opportunity","opportunityId":"current id"};',
  '{"kind":"next_matching_action","actorId":optional existing actor id}. Prefer encounter lifetime for situational additions.',
  'Use only skill IDs in frame.offers, state IDs in frame.party/enemies, and episode/experience IDs provided below. A skill preference requires abilityId.',
  'Use at most 4 operations. Preserve a usable fallback. If no change is justified, return {"operations":[],"reason":"keep current policy","evidenceRefs":[]}.',
].join(' ')

type DecisionDeps = {
  complete: CompanionComplete
  memory: GameplayMemoryStore
  task: AgentTask
  signal: AbortSignal
  getRuntime: () => CompanionBattleRuntime | null
  onResult?: (result: { requestId: string; accepted: boolean; reason?: string; metrics?: CompanionModelMetrics }) => void
}

export function buildBattleDecisionMessages(deps: DecisionDeps, ticket: DecisionTicket): RuntimeMessage[] | null {
  const context = deps.getRuntime()?.coordinator.getDecisionContext(ticket)
  if (!context) return null
  const { recentResults, ...required } = context
  const episodes = deps.memory
    .queryDetailed(ticket.stamp.scope, {
      intent: 'rematch',
      enemyIds: [...new Set(context.frame.enemies.map((enemy) => enemy.enemyId))],
      limit: 3,
    })
    .episodes.map((episode) => ({
      episodeId: episode.episodeId,
      summary: episode.summary.slice(0, 300),
      completeness: episode.completeness,
      evidence: episode.evidence.slice(0, 3),
    }))
  const experiences = deps.memory.queryExperiences(ticket.stamp.scope, {
    enemyIds: [...new Set(context.frame.enemies.map((enemy) => enemy.enemyId))],
    targets: [
      ...context.frame.party.map((actor) => ({ kind: 'actor' as const, id: actor.actorId, hp: actor.hp, hpMax: actor.hpMax, stateIds: actor.states.map((state) => state.id) })),
      ...context.frame.enemies.map((enemy) => ({ kind: 'enemy' as const, id: enemy.enemyId, hp: enemy.hp, hpMax: enemy.hpMax, stateIds: enemy.states.map((state) => state.id) })),
    ],
    limit: 3,
  })
  const payload = {
    goal: deps.task.goal,
    ...required,
    recentResults,
    episodes,
    experienceCoverage: experiences.coverage,
    experienceDetailsTrimmed: experiences.detailsTrimmed,
    experiences: experiences.experiences,
  }
  let content = JSON.stringify(payload)
  // Drop optional historical evidence as whole records; never truncate goal, constraints or JSON.
  while (SYSTEM.length + content.length > 11_900 && (payload.episodes.length || payload.experiences.length || payload.recentResults.length)) {
    if (payload.episodes.length) payload.episodes.pop()
    else if (payload.experiences.length) payload.experiences.pop()
    else payload.recentResults.shift()
    content = JSON.stringify(payload)
  }
  if (SYSTEM.length + content.length > 11_900) throw new Error('TACTIC_REQUIRED_CONTEXT_EXCEEDS_BUDGET')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content },
  ]
}

/** One judgment per battle task; cancellation never makes a second upstream call overlap. */
export function createBattleDecisions(deps: DecisionDeps) {
  let active: Promise<void> | null = null
  let activeRequestId: string | null = null
  let closed = false
  const controller = new AbortController()
  const signal = AbortSignal.any([deps.signal, controller.signal])
  return {
    request(ticket: DecisionTicket): Promise<void> {
      const runtime = deps.getRuntime()
      if (closed || signal.aborted || !runtime || active) {
        if (activeRequestId !== ticket.requestId) runtime?.onDecisionFailed(ticket.requestId)
        return Promise.resolve()
      }
      const work = async () => {
        try {
          const contextStarted = performance.now()
          const messages = buildBattleDecisionMessages(deps, ticket)
          if (!messages) return
          const supplied = JSON.parse(messages[1].content) as {
            frame: Parameters<typeof validateTacticReferences>[1]
            episodes: Array<{ episodeId: string }>
            experiences: Array<{ experienceId: string }>
          }
          const mode = ticket.mode ?? 'quick'
          const contextMs = performance.now() - contextStarted
          const reply = await deps.complete(messages, {
            profileId: deps.task.profileId,
            model: deps.task.model,
            purpose: mode === 'deep' ? 'tactic-deep' : 'tactic-quick',
            signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, ticket.expiresAt - Date.now()))]),
            conversationKey: JSON.stringify(['battle', ticket.stamp.scope.runtimeInstanceId, deps.task.profileId, deps.task.model, deps.task.id, mode]),
          })
          signal.throwIfAborted()
          if (closed || runtime !== deps.getRuntime()) return
          const patch = validateTacticReferences(
            JSON.parse(
              reply.content
                .trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '')
            ),
            supplied.frame,
            [...supplied.episodes.map((episode) => episode.episodeId), ...supplied.experiences.map((experience) => experience.experienceId)]
          )
          const result = runtime.applyTacticPatch(ticket, patch)
          // A declined/unchanged suggestion must not pin the coordinator until ticket expiry.
          if (!result.accepted) runtime.onDecisionFailed(ticket.requestId)
          deps.onResult?.({
            requestId: ticket.requestId,
            ...result,
            metrics: includeCompanionContext(reply.companionMetrics, contextMs),
          })
        } catch (error) {
          runtime.onDecisionFailed(ticket.requestId)
          if (!signal.aborted && !closed) deps.onResult?.({ requestId: ticket.requestId, accepted: false, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      activeRequestId = ticket.requestId
      active = work().finally(() => {
        active = null
        activeRequestId = null
      })
      return active
    },
    close(): void {
      closed = true
      controller.abort()
    },
  }
}
