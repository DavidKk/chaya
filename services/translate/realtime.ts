import { normalizePlaySettings } from '@/lib/translate/play-settings'

import { liveTranslateTexts, ollamaJaToZh } from './live-translate'
import { getTranslationPlaySettings } from './play-settings'
import { isUsefulTranslation } from './text-classify'

export async function translateDialogue(contentRoot: string, texts: unknown, signal?: AbortSignal) {
  if (!Array.isArray(texts) || texts.length > 8 || texts.some((text) => typeof text !== 'string') || texts.join('').length > 2_000) {
    throw new Error('Realtime translation supports current dialogue and choices only, up to 8 segments and 2000 characters')
  }
  const settings = getTranslationPlaySettings(contentRoot)
  if (settings.mode !== 'realtime') throw new Error('Local realtime translation is not enabled for this game')
  const deadline = AbortSignal.timeout(settings.timeoutMs)
  const startedAt = Date.now()
  const result = await liveTranslateTexts(texts as string[], {
    contentRoot,
    engines: ['ollama'],
    local: { model: settings.model, interactive: true, signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
  })
  return { ...result, elapsedMs: Date.now() - startedAt }
}

/** Measure latency using a fixed ordinary Japanese phrase without reading or writing game or shared translation caches. */
export async function benchmarkLocalModel(input: unknown, signal?: AbortSignal) {
  const settings = normalizePlaySettings(input)
  const sample = 'この先の森には魔物がいる。夜になる前に村へ戻ろう。準備ができたら、宿屋の前で待っていてくれ。'
  const startedAt = Date.now()
  const deadline = AbortSignal.timeout(30_000)
  const translation = await ollamaJaToZh(sample, {
    model: settings.model,
    interactive: true,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  })
  if (!isUsefulTranslation(sample, sample, translation, translation)) throw new Error('Local model did not return a valid translation')
  return { sample, translation, characters: Array.from(sample).length, elapsedMs: Date.now() - startedAt }
}
