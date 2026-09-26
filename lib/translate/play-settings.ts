/** Web、服务端和游戏插件共用的游玩翻译约定。 */
export type TranslationPlayMode = 'pretranslated' | 'realtime' | 'subtitle'
export type TranslationPlaySettings = {
  mode: TranslationPlayMode
  /** 空串使用服务端 OLLAMA_MODEL。 */
  model: string
  timeoutMs: number
}

export const DEFAULT_PLAY_SETTINGS: TranslationPlaySettings = { mode: 'pretranslated', model: '', timeoutMs: 8_000 }

export function normalizePlaySettings(raw: unknown): TranslationPlaySettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<TranslationPlaySettings>) : {}
  const timeout = Number(value.timeoutMs)
  return {
    mode: value.mode === 'realtime' || value.mode === 'subtitle' ? value.mode : 'pretranslated',
    model: typeof value.model === 'string' ? value.model.trim().slice(0, 200) : '',
    timeoutMs: Number.isFinite(timeout) ? Math.min(30_000, Math.max(2_000, timeout)) : DEFAULT_PLAY_SETTINGS.timeoutMs,
  }
}
