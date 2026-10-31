import type { ActionEvidence, RuntimeScope } from './types'

export type ExperienceTarget = {
  kind: 'actor' | 'enemy'
  id: number
  hp: number | null
  hpMax: number | null
  stateIds: number[] | null
}

export type HpExperienceConditions = {
  source: { kind: 'actor' | 'enemy'; id: number }
  ability: { kind: 'skill' | 'item'; id: number }
  target: { kind: 'actor' | 'enemy'; id: number }
  hpMax: number | null
  hpBand: 'low' | 'middle' | 'high' | 'unknown'
  stateIds: number[] | null
}

export type ExperienceEvidenceRef = {
  scope: RuntimeScope
  encounterId: string
  eventId: string
  actionId: string
  resultId: string
  hpBefore: number
  hpAfter: number
}

export type HpExperience = {
  experienceId: string
  projectionVersion: 1
  memoryEpoch: number
  scope: Pick<RuntimeScope, 'libraryGameId' | 'dataRevision' | 'playthroughId'>
  conditions: HpExperienceConditions
  claim: 'hp_decreased' | 'hp_increased' | 'hp_unchanged'
  status: 'observation_summary' | 'conditionally_supported' | 'has_counterexamples'
  applicability: 'matching_observed_conditions' | 'conditions_differ' | 'unknown'
  sampleActions: number
  sampleEncounters: number
  targetResults: number
  supportingResults: number
  counterexampleResults: number
  /** Positive means HP loss; negative means actual recovery, including the HP cap. */
  hpLoss: { min: number; max: number }
  evidenceRefs: ExperienceEvidenceRef[]
  counterexampleRefs: ExperienceEvidenceRef[]
  updatedAt: number
  summary: string
}

export type ExperienceQuery = {
  enemyIds?: number[]
  skillIds?: number[]
  targets?: ExperienceTarget[]
  limit?: number
}

export type ExperienceQueryResult = {
  projectionVersion: 1
  memoryEpoch: number
  coverage: 'retained_observations'
  detailsTrimmed: boolean
  experiences: HpExperience[]
}

export type HpExperienceSample = {
  scope: RuntimeScope
  encounterId: string
  eventId: string
  at: number
  evidence: ActionEvidence
}
