import type { MessageKey } from '@/lib/i18n/t'

/**
 * Parse an API error for display. Keep this out of next/server files so it is not pulled into the in-game bundle.
 * Server messages stay English. Known codes are mapped by the caller through i18n.
 */
export function readApiErrorMessage(data: unknown, fallback = 'Request failed'): string {
  if (data == null || typeof data !== 'object') return fallback
  const err = (data as { error?: unknown }).error
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    const msg = (err as { message: string }).message.trim()
    if (msg) return msg
  }
  return fallback
}

/** English Error.message stays in logs. Known codes become the active locale for the user. */
export function thrownMessage(error: unknown, t: (key: MessageKey) => string, fallback: string): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (code === 'TRANSLATION_PLUGIN_NOT_READY') return t('translate.pluginNotReady')
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
