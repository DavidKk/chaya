import { peelChoiceMetaTrail } from '@/lib/translate/choice-meta'
import { normalizeTranslateKey } from '@/lib/translate/lookup'
import { lookupWithRmDigitTemplate, toRmDigitTemplate } from '@/lib/translate/rm-escape'

import { isStorableTranslation, protectForTranslate } from './text-classify'

function lookupCandidates(src: string) {
  const choice = peelChoiceMetaTrail(src)
  const key = choice.core || src
  const guard = protectForTranslate(src)
  // 条件脚本必须原样恢复，不能复用历史上把 if/en 一并翻译的整句缓存。
  return [
    { key, lead: '', trail: choice.trail },
    { key: normalizeTranslateKey(key), lead: '', trail: choice.trail },
    { key: guard.core, lead: guard.lead, trail: guard.trail },
    { key: normalizeTranslateKey(guard.core), lead: guard.lead, trail: guard.trail },
  ]
}

/** 保存、实时查表与任务进度共用的候选键；控制码只在输出时恢复。 */
export function translationLookupKeys(src: string): string[] {
  return [...new Set(lookupCandidates(src).flatMap(({ key }) => [key, toRmDigitTemplate(key)]))].filter(Boolean)
}

export function lookupCachedTranslation(get: (key: string) => string | null | undefined, src: string): string | null {
  for (const { key, lead, trail } of lookupCandidates(src)) {
    if (!key) continue
    const hit = lookupWithRmDigitTemplate((k) => {
      const value = get(k)
      return value && isStorableTranslation(k, value) ? value : null
    }, key)
    if (hit != null) return lead + hit + trail
  }
  return null
}

export function lookupGameTranslation(
  localGet: (key: string) => string | null | undefined,
  sharedGet: (key: string) => string | null | undefined,
  src: string
): { zh: string; engine: 'cache:local' | 'cache:remote' } | null {
  const local = lookupCachedTranslation(localGet, src)
  if (local != null) return { zh: local, engine: 'cache:local' }
  const shared = lookupCachedTranslation(sharedGet, src)
  return shared == null ? null : { zh: shared, engine: 'cache:remote' }
}
