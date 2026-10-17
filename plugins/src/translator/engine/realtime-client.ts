import { createTranslationRuntime } from '../runtime'

/** The game plugin performs live translation directly; the Chaya service is optional for shared-cache queries. */
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
