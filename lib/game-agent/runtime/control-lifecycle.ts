/** Pure lifetime helpers for play/control tasks (companion.md §4.1 / T6). */

export type ControlLifetime = 'goal' | 'until_stopped'

export type ControlTurnReason = 'answered' | 'limit' | 'no_progress' | 'unsupported' | 'verified'

/** Persist / restore: unknown or missing lifetime becomes goal (default). */
export function normalizeControlLifetime(value: unknown): ControlLifetime {
  return value === 'until_stopped' ? 'until_stopped' : 'goal'
}

/**
 * Prefer an explicit lifetime from start/classify. Legacy surface=companion
 * forced a single turn; without an explicit lifetime that remains goal.
 */
export function resolveControlLifetime(input: { lifetime?: unknown; surface?: string }): ControlLifetime {
  if (input.lifetime === 'goal' || input.lifetime === 'until_stopped') return input.lifetime
  return 'goal'
}

/**
 * Decide whether the outer play loop should keep going after one tool-loop turn.
 * - goal: end only when the turn reports a verified/answered completion; limit
 *   and no_progress must not finish or pretend the goal is done.
 * - until_stopped: continue under the existing watch / input guards until Stop.
 */
export function shouldContinueControlCycle(input: { lifetime: ControlLifetime; reason: ControlTurnReason }): boolean {
  if (input.lifetime === 'until_stopped') {
    return input.reason === 'answered' || input.reason === 'limit' || input.reason === 'no_progress' || input.reason === 'verified'
  }
  // goal: only a verified/answered finish closes the task; budget / stall reasons continue.
  if (input.reason === 'answered' || input.reason === 'verified') return false
  if (input.reason === 'limit' || input.reason === 'no_progress') return true
  return false
}

/** True when a goal-lifetime task may finish after this turn (not limit/no_progress). */
export function isVerifiedGoalCompletion(reason: ControlTurnReason): boolean {
  return reason === 'answered' || reason === 'verified'
}
