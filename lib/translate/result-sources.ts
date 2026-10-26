import type { BatchExecutionSource } from './runtime-api'
import type { SentencePlan, SentenceRecord } from './sentence-plan'

export type ResultWrite = { record: SentenceRecord; sources: string[] }

/** Replanning can read this request's own writes back through shared or local aliases. */
export function replannedResultSources(plan: SentencePlan, writes: ResultWrite[]): string[] {
  return [
    ...new Set(
      plan.matches.flatMap(({ record }) => {
        const own = writes.find(
          ({ record: written }) =>
            (written.id === record.id && written.revision === record.revision) ||
            (record.local && written.src === record.src && written.zh === record.zh && written.engine === record.engine)
        )
        return own?.sources ?? ['cache']
      })
    ),
  ]
}

export type TranslationProvenance = {
  resource?: import('./resource-types').ResourceHit
  engine?: string
  /** Sources of accepted text, independently of requests that were discarded. */
  resultSources?: string[]
  /** Includes time spent waiting for or joining an engine request. */
  engineWork?: boolean
}

export function resultSources(item: TranslationProvenance): string[] {
  if (item.resultSources) return item.resultSources
  // Older composites do not identify which engine supplied their gaps.
  if (item.engine === 'cache:partial') return ['cache', 'unknown']
  return item.engine ? [item.engine] : []
}

export function isCacheResult(item: TranslationProvenance): boolean {
  const sources = resultSources(item)
  return sources.length > 0 && sources.every((source) => source === 'cache' || source.startsWith('cache:'))
}

export function isCacheExecution(item: TranslationProvenance): boolean {
  return isCacheResult(item) && !item.engineWork
}

function batchSource(name: string): BatchExecutionSource {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/^live:/, '')
  if (raw === 'cache' || raw.startsWith('cache:')) return 'cache'
  if (raw === 'apple' || raw.startsWith('apple:')) return 'apple'
  if (raw === 'agent' || raw.startsWith('agent:')) return 'agent'
  if (raw === 'bergamot' || raw.startsWith('bergamot:')) return 'bergamot'
  if (raw === 'ollama' || raw.startsWith('ollama:')) return 'ollama'
  if (raw === 'platform' || raw.startsWith('google') || raw.startsWith('bing') || raw.startsWith('platform:')) return 'platform'
  return 'unknown'
}

export function batchSources(items: TranslationProvenance[]): BatchExecutionSource[] {
  const order: BatchExecutionSource[] = ['apple', 'agent', 'platform', 'bergamot', 'ollama', 'unknown', 'cache']
  const present = new Set(
    items.flatMap((item) => {
      const sources = resultSources(item)
      return sources.length ? sources.map(batchSource) : ['unknown' as const]
    })
  )
  return order.filter((source) => present.has(source))
}
