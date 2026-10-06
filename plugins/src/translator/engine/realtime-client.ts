import { createTranslationRuntime } from '../runtime'

/** 实时翻译直接由游戏插件执行；Chaya 服务只可用于共享翻译库查询。 */
export function createRealtimeClient(contentRoot: string) {
  const host = globalThis as typeof globalThis & { __chayaTranslationRuntime?: ReturnType<typeof createTranslationRuntime> }
  host.__chayaTranslationRuntime?.dispose()
  const runtime = createTranslationRuntime(contentRoot)
  host.__chayaTranslationRuntime = runtime
  return {
    settings: runtime.settings,
    remoteOnline: runtime.remoteOnline,
    activity: runtime.recordActivity,
    dispose: runtime.dispose,
    request: (texts: string[], signal: AbortSignal) => runtime.translate(texts, { signal, interactive: true }),
    requestBackground: (texts: string[], signal: AbortSignal) => runtime.translate(texts, { signal }),
  }
}
