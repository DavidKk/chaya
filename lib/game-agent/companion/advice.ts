/**
 * Pure advice / structured-output validation for companion chat & candidates (T5).
 * Names and evidence come from persisted facts; unknown mechanics stay conditional.
 */

import type { HpExperience } from './experience-types'
import type { AdviceContext, CompletenessKind, FactLegalAction, FactView, KnownMechanics, MemoryEpisode, StructuredOutputBlock } from './types'

export type ValidatedChatPayload = {
  text: string
  blocks: StructuredOutputBlock[]
  degraded: boolean
  mode: 'plain' | 'structured'
}

const MAX_CHAT_CHARS = 1_200
const MAX_EVIDENCE_SUMMARY = 280

const RANK: Record<CompletenessKind, number> = {
  unknown: 0,
  partial: 1,
  complete_for_claim: 2,
}

export function buildAdviceContext(input: { facts: FactView; episodes: MemoryEpisode[]; experiences?: HpExperience[]; knownGaps?: string[] }): AdviceContext {
  const { facts } = input
  return {
    stamp: facts.stamp,
    currentParty: facts.current.party.value ?? [],
    currentEnemies: facts.current.enemies.value ?? [],
    legalActions: facts.current.legalActions.value ?? [],
    knownMechanics: facts.mechanics,
    historicalEpisodes: input.episodes.slice(0, 3),
    historicalExperiences: input.experiences?.slice(0, 3),
    knownGaps: input.knownGaps ?? collectKnownGaps(facts),
    spoilerFilterApplied: facts.mechanics.spoilerFilterApplied,
  }
}

function collectKnownGaps(facts: FactView): string[] {
  const gaps: string[] = []
  if (!facts.current.enemies.known) gaps.push('enemies_unknown')
  if (!facts.current.legalActions.known) gaps.push('legal_actions_unknown')
  if (!facts.current.party.known) gaps.push('party_unknown')
  for (const skill of Object.values(facts.mechanics.skills)) {
    if (!skill.isDisarmable.known) gaps.push(`skill:${skill.skillId}:disarm_unknown`)
  }
  return gaps
}

export function legalSkillIds(actions: FactLegalAction[]): Set<number> {
  const ids = new Set<number>()
  for (const action of actions) {
    if (action.kind === 'skill' && typeof action.id === 'number') ids.add(action.id)
  }
  return ids
}

/** Presence of guard is not proof that shielding works against a threat. */
export function canClaimDefenseUseful(_actions: FactLegalAction[]): boolean {
  return false
}

/** Disarm is useful only when the referenced mechanic is known-disarmable and that skill is legal now. */
export function canClaimDisarmUseful(actions: FactLegalAction[], mechanics: KnownMechanics, skillId?: number): boolean {
  if (skillId == null) return false
  const skill = mechanics.skills[skillId]
  if (!skill || !skill.isDisarmable.known || skill.isDisarmable.value !== true) return false
  return legalSkillIds(actions).has(skillId)
}

export function hasGuardAction(actions: FactLegalAction[]): boolean {
  return actions.some((action) => action.kind === 'guard')
}

export function conditionalDefenseText(locale = 'zh'): string {
  if (locale.startsWith('zh')) return '当前有防御指令，但是否有效要看未知机制，不能当成必成。'
  if (locale.startsWith('ja')) return '防御は選べるが、未知の効果までは保証できない。'
  if (locale.startsWith('ko')) return '방어는 가능하지만 未知 메커니즘까지 통한다고 단정할 수 없어.'
  return 'Guard is available, but unknown mechanics are not proven.'
}

export function conditionalDisarmText(locale = 'zh'): string {
  if (locale.startsWith('zh')) return '只有机制明确可封且该技能当前合法时，才值得尝试打断。'
  if (locale.startsWith('ja')) return '封じが既知で合法な時だけ、技封じを試せる。'
  if (locale.startsWith('ko')) return '봉인이 알려져 있고 合法할 때만 끊기를 시도할 수 있어.'
  return 'Try a seal only when that mechanic is known and the skill is legal now.'
}

export function episodeEvidenceSummary(episodes: MemoryEpisode[], locale = 'zh'): string {
  const top = episodes[0]
  if (!top) {
    if (locale.startsWith('zh')) return '我这边没有足够的已验证经历可引用。'
    return 'I do not have enough verified history to cite.'
  }
  return top.summary.slice(0, MAX_EVIDENCE_SUMMARY)
}

function clampCompleteness(requested: unknown, actual: CompletenessKind): CompletenessKind {
  const next = requested === 'complete_for_claim' || requested === 'partial' || requested === 'unknown' ? (requested as CompletenessKind) : actual
  return RANK[next] <= RANK[actual] ? next : actual
}

function resolvedSkillName(skillId: number, context: AdviceContext): string | null {
  const mechanic = context.knownMechanics.skills[skillId]
  if (mechanic?.name) return mechanic.name.slice(0, 80)
  const legal = context.legalActions.find((item) => item.kind === 'skill' && item.id === skillId)
  return legal?.name ? legal.name.slice(0, 80) : null
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const value = JSON.parse(trimmed) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export function looksLikeStructuredPayload(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function trustedProse(text: string): string {
  const next = text.trim().slice(0, MAX_CHAT_CHARS)
  if (!next || looksLikeStructuredPayload(next) || plainTextLooksGrounded(next)) return ''
  return next
}

function degradeStructuredChat(context: AdviceContext, locale: string): ValidatedChatPayload {
  const experience = context.historicalExperiences?.[0]
  if (experience) {
    return {
      text: '',
      blocks: [{ kind: 'experience_ref', experienceId: experience.experienceId, summary: experience.summary }],
      degraded: true,
      mode: 'structured',
    }
  }
  const episode = context.historicalEpisodes[0]
  return {
    text: episodeEvidenceSummary(context.historicalEpisodes, locale),
    blocks: episode
      ? [
          {
            kind: 'evidence_ref',
            episodeId: episode.episodeId,
            summary: episode.summary.slice(0, MAX_EVIDENCE_SUMMARY),
            completeness: episode.completeness,
          },
        ]
      : [],
    degraded: true,
    mode: 'structured',
  }
}

function resolveTargetActorId(raw: unknown, context: AdviceContext): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  if (context.currentParty.some((member) => member.actorId === raw)) return raw
  if (context.currentEnemies.some((enemy) => enemy.enemyId === raw)) return raw
  return undefined
}

function trustedSkillMechanism(skillId: number, context: AdviceContext, locale: string): string {
  const skill = context.knownMechanics.skills[skillId]
  if (!skill || skill.source !== 'database_entry') return ''
  return (skill.description || '').trim().slice(0, locale.startsWith('zh') ? 80 : 96)
}

function validateEvidenceBlock(raw: Record<string, unknown>, episodes: MemoryEpisode[]): StructuredOutputBlock | null {
  const episodeId = typeof raw.episodeId === 'string' ? raw.episodeId : ''
  const episode = episodes.find((item) => item.episodeId === episodeId)
  if (!episode) return null
  return {
    kind: 'evidence_ref',
    episodeId: episode.episodeId,
    summary: episode.summary.slice(0, MAX_EVIDENCE_SUMMARY),
    completeness: clampCompleteness(raw.completeness, episode.completeness),
  }
}

function validateSkillAdvice(raw: Record<string, unknown>, context: AdviceContext, locale = 'zh'): StructuredOutputBlock | null {
  const skillId = typeof raw.skillId === 'number' ? raw.skillId : Number(raw.skillId)
  if (!Number.isFinite(skillId)) return null
  if (!legalSkillIds(context.legalActions).has(skillId)) return null
  const skillName = resolvedSkillName(skillId, context)
  if (!skillName) return null

  const disarmOk = canClaimDisarmUseful(context.legalActions, context.knownMechanics, skillId)
  const fallback = locale.startsWith('zh') ? '仅建议使用当前合法技能；未知机制不作保证。' : 'Only current legal skills are suggested; unknown mechanics stay unproven.'
  const condition = disarmOk ? conditionalDisarmText(locale) : hasGuardAction(context.legalActions) ? conditionalDefenseText(locale) : fallback
  const mechanism = trustedSkillMechanism(skillId, context, locale)
  const rationale = [condition, mechanism].filter(Boolean).join(' ')

  return {
    kind: 'skill_advice',
    skillId,
    skillName,
    targetActorId: resolveTargetActorId(raw.targetActorId, context),
    rationale: rationale.slice(0, 240),
    knownCondition: disarmOk,
  }
}

/** Plain chat that smuggles experience / skill claims without structure is rejected. */
export function plainTextLooksGrounded(text: string): boolean {
  return /(episodeId|evidence_ref|experienceId|experience_ref|skill_advice|上次|击倒|经历|skillId|【.+】)/i.test(text)
}

export function validateStructuredChatOutput(content: string, context: AdviceContext, locale = 'zh'): ValidatedChatPayload {
  const parsed = parseJsonObject(content)
  if (!parsed) {
    if (looksLikeStructuredPayload(content) || plainTextLooksGrounded(content)) return degradeStructuredChat(context, locale)
    const text = content.trim().slice(0, MAX_CHAT_CHARS)
    return { text, blocks: [], degraded: false, mode: 'plain' }
  }

  const text = typeof parsed.text === 'string' ? trustedProse(parsed.text) : typeof parsed.message === 'string' ? trustedProse(parsed.message) : ''

  const rawBlocks = Array.isArray(parsed.blocks)
    ? parsed.blocks
    : Array.isArray(parsed.effects)
      ? parsed.effects
      : Array.isArray(parsed.actions)
        ? parsed.actions
        : Array.isArray(parsed.advice)
          ? parsed.advice
          : []

  const blocks: StructuredOutputBlock[] = []
  let invalid = false
  for (const item of rawBlocks) {
    if (!item || typeof item !== 'object') {
      invalid = true
      continue
    }
    const raw = item as Record<string, unknown>
    if (raw.kind === 'experience_ref') {
      const experience = context.historicalExperiences?.find((item) => item.experienceId === raw.experienceId)
      if (experience) blocks.push({ kind: 'experience_ref', experienceId: experience.experienceId, summary: experience.summary })
      else invalid = true
      continue
    }
    if (raw.kind === 'evidence_ref') {
      const block = validateEvidenceBlock(raw, context.historicalEpisodes)
      if (block) blocks.push(block)
      else invalid = true
      continue
    }
    if (raw.kind === 'skill_advice') {
      const block = validateSkillAdvice(raw, context, locale)
      if (block) blocks.push(block)
      else invalid = true
      continue
    }
    invalid = true
  }

  if ((invalid && blocks.length === 0) || (!text && blocks.length === 0)) return degradeStructuredChat(context, locale)

  return {
    text: blocks.some((block) => block.kind === 'experience_ref') ? '' : text,
    blocks,
    degraded: invalid,
    mode: 'structured',
  }
}

export function renderValidatedChatText(payload: ValidatedChatPayload): string {
  const text = looksLikeStructuredPayload(payload.text) ? '' : payload.text
  if (!payload.blocks.length) return text
  const extras = payload.blocks
    .map((block) => {
      if (block.kind === 'evidence_ref') return block.summary
      if (block.kind === 'experience_ref') return block.summary
      if (block.kind === 'skill_advice') return `${block.skillName}: ${block.rationale}`
      return ''
    })
    .filter(Boolean)
  if (!text) return extras.join('\n').slice(0, MAX_CHAT_CHARS)
  if (!extras.length) return text
  return `${text}\n${extras.join('\n')}`.slice(0, MAX_CHAT_CHARS)
}
