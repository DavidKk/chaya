import type { CacheLangPair } from './cache-lang'
import type { SentencePlan } from './sentence-plan'
import type { StructureAnnotation, StructuredDocument } from './structured-segments'

export const CACHE_TEST_MAX_LENGTH = 20_000
export const CACHE_TEST_MAX_CANDIDATES = 500
export type CacheTestScope = 'shared' | 'game' | 'combined'
export type CacheTestInput = CacheLangPair & { text: string; scope: CacheTestScope; gameId?: string; structure?: StructureAnnotation }
export type CacheTestResult = {
  query: CacheTestInput
  ruleVersion: number
  corpusVersion: string
  structure: StructuredDocument
  plan: SentencePlan
  preview: string
  candidateCount: number
  diagnostics: string[]
}
