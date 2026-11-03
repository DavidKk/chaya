import type { PlayerConstraint } from '@/lib/game-agent/companion/core/types'
import type { FactView } from '@/lib/game-agent/companion/types'

import type { CompanionBattleRuntime } from './runtime'

export const BATTLE_INTENT_SYSTEM = [
  'Also extract explicit battle constraints from the actual player prompt, never from quoted game dialogue, memory or your reply.',
  'Include battleIntent: {"clarify":boolean,"constraints":[{"kind":"forbid_skill|forbid_item|focus_enemy|reserve_mp","param":number,"quote":"exact player words"}]}.',
  'At most 8 constraints. IDs must exist in battleIntentContext. reserve_mp is an absolute MP amount (param is the integer number, e.g. 50), never convert percentages yourself.',
  'A general request to handle battles, including until stopped, has constraints=[] and clarify=false. Listed abilities are context, never requests to forbid them.',
  'Each quote must explicitly identify the affected skill, item, enemy, or MP amount. Never add tactical restrictions that the player did not request.',
  'Examples:',
  '- "请一直帮我处理遇到的战斗，直到我叫停。" => {"clarify":false,"constraints":[]}.',
  '- "接下来保留至少 50 点 MP。" => {"clarify":false,"constraints":[{"kind":"reserve_mp","param":50,"quote":"50"}]}.',
  'Pure chat/strategy questions have constraints=[] and clarify=false. A prohibition of all items is forbid_item param=0.',
  'If an explicit tactical request cannot be represented, set clarify=true; never claim it was applied.',
  'This entry cannot start/resume/stop control, remove existing prohibitions, or change authorization.',
].join(' ')

export const BATTLE_INTENT_FORMAT = {
  type: 'object',
  properties: {
    clarify: { type: 'boolean' },
    constraints: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['forbid_skill', 'forbid_item', 'focus_enemy', 'reserve_mp'] },
          param: { type: 'integer', minimum: 0, maximum: 999999 },
          quote: { type: 'string' },
        },
        required: ['kind', 'param', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['clarify', 'constraints'],
  additionalProperties: false,
} as const

export type BattleIntentReceipt = {
  context: unknown
  accept: (input: unknown) => 'applied' | 'none' | 'clarify' | 'stale'
}

function namesTarget(quote: string, target: { id?: number; name?: string } | undefined): boolean {
  if (!target) return false
  return (
    (!!target.name?.trim() && quote.includes(target.name)) ||
    (typeof target.id === 'number' && Number.isInteger(target.id) && new RegExp(`(?<!\\p{N})${target.id}(?!\\p{N})`, 'u').test(quote))
  )
}

/** Source identity and ordering belong to the host; a model only supplies bounded candidates. */
export function createBattleIntents(deps: { runtime: CompanionBattleRuntime; currentFacts: () => FactView; signal: AbortSignal; now?: () => number }) {
  let sequence = 0
  const now = deps.now ?? Date.now
  const seen = new Map<string, string>()
  return {
    begin(sourceId: string, prompt: string, initial = false): BattleIntentReceipt | null {
      if (deps.signal.aborted || seen.has(sourceId) || !prompt.trim() || prompt.length > 8_000) return null
      const runtime = deps.runtime
      if (!initial && !['running', 'waiting_game', 'waiting_decision'].includes(runtime.getStatus())) return null
      seen.set(sourceId, prompt)
      if (seen.size > 64) seen.delete(seen.keys().next().value!)
      const order = ++sequence
      const facts = deps.currentFacts()
      const stampOf = (view: FactView) => JSON.stringify([view.stamp.scope, view.stamp.contextEpoch, view.current.encounterId.value, view.capabilities, view.mechanics])
      const stamp = stampOf(facts)
      const context = JSON.stringify([facts.stamp.scope, facts.stamp.contextEpoch])
      const goalRevision = runtime.coordinator.getGoalRevision()
      const lease = runtime.coordinator.getActiveLease()
      const expiresAt = now() + 10_000
      const skills = Object.values(facts.mechanics.skills).map((skill) => ({ id: skill.skillId, name: skill.name }))
      const enemies = (facts.current.enemies.value ?? []).map((enemy) => ({ id: enemy.enemyId, name: enemy.name }))
      const items = (facts.current.legalActions.value ?? []).filter((action) => action.kind === 'item').map((action) => ({ id: action.id, name: action.name }))
      let consumed = false
      return {
        context: { skills, enemies, items, constraints: runtime.coordinator.getPlayerConstraints(), initial },
        accept(input) {
          if (consumed) return 'stale'
          consumed = true
          const current = deps.currentFacts()
          // Chat extracts no mutations, so ordinary battle progress cannot expire it.
          if (
            !deps.signal.aborted &&
            order === sequence &&
            JSON.stringify([current.stamp.scope, current.stamp.contextEpoch]) === context &&
            input &&
            typeof input === 'object' &&
            !Array.isArray(input) &&
            Object.keys(input).length === 2 &&
            (input as Record<string, unknown>).clarify === false &&
            Array.isArray((input as Record<string, unknown>).constraints) &&
            ((input as Record<string, unknown>).constraints as unknown[]).length === 0
          )
            return 'none'
          if (
            deps.signal.aborted ||
            order !== sequence ||
            now() >= expiresAt ||
            stamp !== stampOf(current) ||
            goalRevision !== runtime.coordinator.getGoalRevision() ||
            (!initial && (!lease || !runtime.arbiter.isCurrent(lease))) ||
            (initial && runtime.getStatus() !== 'idle')
          )
            return 'stale'
          if (!input || typeof input !== 'object' || Array.isArray(input)) return 'clarify'
          const value = input as Record<string, unknown>
          if (
            value.clarify !== false ||
            !Array.isArray(value.constraints) ||
            value.constraints.length > 8 ||
            Object.keys(value).some((key) => !['clarify', 'constraints'].includes(key))
          )
            return 'clarify'
          const constraints: PlayerConstraint[] = []
          for (const entry of value.constraints) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'clarify'
            const candidate = entry as Record<string, unknown>
            const { kind, param, quote } = candidate
            if (
              Object.keys(candidate).some((key) => !['kind', 'param', 'quote'].includes(key)) ||
              typeof quote !== 'string' ||
              !quote.trim() ||
              !prompt.includes(quote) ||
              typeof param !== 'number' ||
              !Number.isInteger(param) ||
              param < 0 ||
              param > 999999
            )
              return 'clarify'
            if (
              kind === 'forbid_skill' &&
              !namesTarget(
                quote,
                skills.find((skill) => skill.id === param)
              )
            )
              return 'clarify'
            else if (
              kind === 'focus_enemy' &&
              !namesTarget(
                quote,
                enemies.find((enemy) => enemy.id === param)
              )
            )
              return 'clarify'
            else if (
              kind === 'forbid_item' &&
              param !== 0 &&
              !namesTarget(
                quote,
                items.find((item) => item.id === param)
              )
            )
              return 'clarify'
            else if (kind === 'reserve_mp' && !new RegExp(`(?<![\\p{N}.])${param}(?![\\p{N}.])`, 'u').test(quote)) return 'clarify'
            else if (!['forbid_skill', 'forbid_item', 'focus_enemy', 'reserve_mp'].includes(String(kind))) return 'clarify'
            const id = kind === 'reserve_mp' || kind === 'focus_enemy' ? `player:${kind}` : `player:${kind}:${param}`
            constraints.push({ id, kind: kind as PlayerConstraint['kind'], param })
          }
          const ids = new Set([...runtime.coordinator.getPlayerConstraints(), ...constraints].map((constraint) => constraint.id))
          if (ids.size > 32) return 'clarify'
          for (const constraint of constraints) runtime.addPlayerConstraint(constraint)
          return constraints.length ? 'applied' : 'none'
        },
      }
    },
  }
}
