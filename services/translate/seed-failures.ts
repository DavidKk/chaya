/** Terminal automatic attempts are separate from successful translations and job checkpoints. */
import fs from 'node:fs'
import path from 'node:path'

import type { SeedProgress } from '@/lib/translate/runtime-api'

import { readSeedJobState, seedJobFile } from './seed-job-state'
import { charCount } from './text-classify'

export function seedFailureFile(contentRoot: string) {
  return seedJobFile(contentRoot).replace(/\.json$/, '.failures.ndjson')
}

export function readSeedFailures(contentRoot: string): Map<string, string> {
  const failures = new Map((readSeedJobState(contentRoot)?.failedSources ?? []).map((src) => [src, '']))
  const file = seedFailureFile(contentRoot)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return failures
    throw error
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as { src: string; error: string | null }
      if (event.error === null) failures.delete(event.src)
      else failures.set(event.src, event.error)
    } catch {
      /* Ignore corrupted or truncated line during append */
    }
  }
  return failures
}

export function writeSeedFailure(contentRoot: string, src: string, error: string | null) {
  const file = seedFailureFile(contentRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Append one event in one write: manual saves cannot overwrite worker failure checkpoints.
  fs.appendFileSync(file, `${JSON.stringify({ src, error, at: Date.now() })}\n`, 'utf8')
}

export function isSeedTarget(target?: string): boolean {
  return !target || /^(?:ch|zh|zh-cn|zh-hans)$/i.test(target)
}

export function attachSeedFailures<T extends { src: string; savedZh?: string }>(contentRoot: string, items: T[], target?: string) {
  const failures = isSeedTarget(target) ? readSeedFailures(contentRoot) : new Map<string, string>()
  return items.map((item): T & { translationFailure?: { error: string } } =>
    !item.savedZh?.trim() && failures.has(item.src) ? { ...item, translationFailure: { error: failures.get(item.src)! } } : item
  )
}

export function recordSeedFailure(contentRoot: string, item: { src: string; error?: string }, progress: SeedProgress) {
  writeSeedFailure(contentRoot, item.src, item.error || 'No valid translation returned')
  progress.failedCount = (progress.failedCount ?? 0) + 1
  progress.failedChars = (progress.failedChars ?? 0) + charCount(item.src)
  progress.missing--
  progress.missingChars -= charCount(item.src)
}
