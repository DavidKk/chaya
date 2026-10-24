/**
 * Bundled worker: full RGSS list extract off the Next.js main thread.
 * Writes the final API JSON body to a temp file and posts only the path so the
 * parent never JSON.parse / structured-clones the large items array.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

import { resolveGame } from '@/lib/game/resolve'
import { detectSourceLanguage } from '@/lib/translate/source-text'

import { loadRgssTranslationItems } from '../rgss'

try {
  const contentRoot = String((workerData as { contentRoot?: string })?.contentRoot || '')
  if (!contentRoot) throw new Error('items-worker: missing contentRoot')
  const items = loadRgssTranslationItems(contentRoot)
  const resolved = resolveGame(contentRoot)
  const engine = resolved?.ok && (resolved.engine === 'VX Ace' || resolved.engine === 'VX') ? resolved.engine : null
  const detected = detectSourceLanguage(items.map((i) => i.src))
  const body = {
    ok: true,
    preparing: false,
    items,
    engine,
    contentRoot,
    locales: {
      hasLocales: true,
      primaryLanguage: detected,
      currentSourceLang: detected,
      currentTargetLang: 'zh',
      availableLanguages: [...new Set([detected, 'zh'])],
    },
  }
  const out = path.join(os.tmpdir(), `chaya-rgss-list-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(out, JSON.stringify(body))
  parentPort?.postMessage({ ok: true as const, path: out, count: items.length })
} catch (error) {
  parentPort?.postMessage({ ok: false as const, error: error instanceof Error ? error.message : String(error) })
}
