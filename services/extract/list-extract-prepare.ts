/**
 * Single-flight list extract for /translate/list (`mode: extract-items`).
 * HTTP returns preparing immediately; RGSS work runs in a worker thread (file IPC).
 * @see docs/translation-mainthread-offload.md §3.2
 */
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { RGSS_EXTRACT_WORKER_PATH } from '@/constants/paths'
import { gameContentReadPath } from '@/lib/game/content-files'
import { resolveGame } from '@/lib/game/resolve'
import { seedProgressStamp } from '@/services/translate/scheduler/seed-inventory'
import { singleFlight } from '@/services/translate/scheduler/single-flight'

import { type ExtractedItemsResult, type ExtractedLocalesMeta, type ExtractedTranslationItem, loadExtractedItemsWithLocales } from './lib/extract-items'

export type ListExtractPayload = {
  items: ExtractedTranslationItem[]
  locales?: ExtractedLocalesMeta
  engine?: 'VX Ace' | 'VX' | null
  contentRoot: string
}

type Ready = { ok: true; payload?: ListExtractPayload; bodyPath?: string; stamp: string } | { ok: false; error: string; stamp: string }

const flights = new Map<string, Promise<Ready>>()
const ready = new Map<string, Ready>()

function listStamp(contentRoot: string) {
  const extract = gameContentReadPath(contentRoot, 'extractStrings', { alsoParent: true })
  return JSON.stringify([path.resolve(contentRoot), seedProgressStamp(contentRoot), extract])
}

function cacheKey(contentRoot: string, sourceLang?: string, targetLang?: string) {
  return `${path.resolve(contentRoot)}::${sourceLang || ''}::${targetLang || ''}`
}

function runRgssExtractWorker(contentRoot: string): Promise<{ bodyPath: string }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(RGSS_EXTRACT_WORKER_PATH)) {
      reject(new Error('RGSS_EXTRACT_WORKER_MISSING'))
      return
    }
    let settled = false
    const worker = new Worker(RGSS_EXTRACT_WORKER_PATH, { workerData: { contentRoot } })
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      void worker.terminate()
      fn()
    }
    worker.once('message', (message: { ok: boolean; path?: string; error?: string }) => {
      finish(() => {
        if (message?.ok && message.path) resolve({ bodyPath: message.path })
        else reject(new Error(message?.error || 'RGSS extract worker failed'))
      })
    })
    worker.once('error', (error) => finish(() => reject(error)))
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(() => reject(new Error(`RGSS extract worker exited: ${code}`)))
    })
  })
}

async function buildPayload(contentRoot: string, opts?: { sourceLang?: string; targetLang?: string }): Promise<Ready> {
  const stamp = listStamp(contentRoot)
  const resolved = resolveGame(contentRoot)
  if (resolved?.ok && (resolved.engine === 'VX Ace' || resolved.engine === 'VX')) {
    try {
      const { bodyPath } = await runRgssExtractWorker(contentRoot)
      return { ok: true, bodyPath, stamp }
    } catch (_error) {
      // Worker missing / crash: fall back to sync (may hitch); still single-flight.
      const { loadRgssTranslationItems } = await import('./lib/rgss')
      const items = loadRgssTranslationItems(contentRoot)
      const { detectSourceLanguage } = await import('@/lib/translate/source-text')
      const detected = detectSourceLanguage(items.map((i) => i.src))
      return {
        ok: true,
        stamp,
        payload: {
          items,
          engine: resolved.engine,
          contentRoot,
          locales: {
            hasLocales: true,
            currentSourceLang: detected,
            currentTargetLang: 'zh',
            availableLanguages: [...new Set([detected, 'zh'])],
          },
        },
      }
    }
  }
  await new Promise<void>((r) => setImmediate(r))
  const res: ExtractedItemsResult = loadExtractedItemsWithLocales(contentRoot, opts)
  return { ok: true, stamp, payload: { items: res.items, locales: res.locales, engine: null, contentRoot } }
}

function startFlight(contentRoot: string, opts?: { sourceLang?: string; targetLang?: string }) {
  const key = cacheKey(contentRoot, opts?.sourceLang, opts?.targetLang)
  const stamp = listStamp(contentRoot)
  return singleFlight(flights, key, async () => {
    try {
      const result = await buildPayload(contentRoot, opts)
      ready.set(key, result)
      return result
    } catch (error) {
      const result: Ready = { ok: false, error: error instanceof Error ? error.message : String(error), stamp }
      ready.set(key, result)
      return result
    }
  })
}

export type ListExtractSnap = { preparing: true } | ({ preparing: false } & ListExtractPayload) | { preparing: false; error: string } | { preparing: false; bodyPath: string }

function fromReady(cached: Ready): ListExtractSnap {
  if (!cached.ok) return { preparing: false, error: cached.error }
  if (cached.bodyPath) return { preparing: false, bodyPath: cached.bodyPath }
  if (cached.payload) return { preparing: false, ...cached.payload }
  return { preparing: false, error: 'empty extract result' }
}

/**
 * Non-blocking entry for extract-items.
 * - Cache hit → full payload or bodyPath
 * - Else kick off single-flight work and return `{ preparing: true }`
 */
export function requestListExtract(contentRoot: string, opts?: { sourceLang?: string; targetLang?: string }): ListExtractSnap {
  const key = cacheKey(contentRoot, opts?.sourceLang, opts?.targetLang)
  const stamp = listStamp(contentRoot)
  const cached = ready.get(key)
  if (cached && cached.stamp === stamp) return fromReady(cached)
  if (cached) {
    if (cached.ok && cached.bodyPath) {
      try {
        fs.unlinkSync(cached.bodyPath)
      } catch {
        /* */
      }
    }
    ready.delete(key)
  }
  void startFlight(contentRoot, opts)
  return { preparing: true }
}

/** Poll companion — same single-flight / cache as requestListExtract. */
export function pollListExtract(contentRoot: string, opts?: { sourceLang?: string; targetLang?: string }): ListExtractSnap {
  const key = cacheKey(contentRoot, opts?.sourceLang, opts?.targetLang)
  const stamp = listStamp(contentRoot)
  const cached = ready.get(key)
  if (cached && cached.stamp === stamp) return fromReady(cached)
  if (!flights.has(key)) void startFlight(contentRoot, opts)
  return { preparing: true }
}

/** Test helper */
export function resetListExtractForTests() {
  for (const value of ready.values()) {
    if (value.ok && value.bodyPath) {
      try {
        fs.unlinkSync(value.bodyPath)
      } catch {
        /* */
      }
    }
  }
  flights.clear()
  ready.clear()
}
