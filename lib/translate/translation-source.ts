/**
 * 翻译来源粗粒度分类与手动翻译判定
 * 覆盖：手动 (manual)、智能体 (agent)、在线平台 (platform)、本地离线 (offline)、缓存/种子 (cache)
 */

export type TranslationSourceKind = 'manual' | 'agent' | 'platform' | 'offline' | 'cache'

export function classifyTranslationSource(engine: string | null | undefined): TranslationSourceKind {
  const e = String(engine || '')
    .trim()
    .toLowerCase()
  if (!e) return 'cache'
  if (e === 'manual') return 'manual'
  if (e === 'agent' || e.includes('agent')) return 'agent'
  if (e.includes('google') || e.includes('bing')) return 'platform'
  if (e.includes('apple') || e.includes('bergamot') || e.includes('ollama')) return 'offline'
  return 'cache'
}

export interface TranslationItemSourceLike {
  engine?: string
  zh?: string
  initialZh?: string
  savedZh?: string
}

/**
 * 判断是否为手动翻译（权重最高）：
 * 1. 明确标记为 manual 引擎（如手动保存）
 * 2. 或用户在界面中进行了编辑改动（草稿态）
 */
export function isManualTranslation(item: TranslationItemSourceLike): boolean {
  if (!item.zh || !item.zh.trim()) return false
  if (classifyTranslationSource(item.engine) === 'manual') return true
  const original = item.initialZh ?? item.savedZh ?? ''
  if (original && item.zh !== original) return true
  return false
}

/**
 * 解析条目最终翻译来源类型（未翻译返回 null）
 */
export function resolveItemSourceKind(item: TranslationItemSourceLike): TranslationSourceKind | null {
  if (!item.zh || !item.zh.trim()) return null
  if (isManualTranslation(item)) return 'manual'
  return classifyTranslationSource(item.engine)
}
