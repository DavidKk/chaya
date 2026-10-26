import type { ResourceHit } from './resource-types'

/** Immutable evidence, not a semantic classification or a claim of mistranslation. */
export type TranslationObservation = {
  eventId: string
  occurredAt: number
  sourceText: string
  targetText: string | null
  sourceLanguage: string
  targetLanguage: string
  engine?: string
  gameId?: string
  contentRoot?: string
  speaker?: string
  context?: string
  error: string
  resource?: ResourceHit
}
