import type { MessageKey, MessageParams } from '@/lib/i18n'
import type { TranslationFailureLog } from '@/lib/translate/runtime-api'

type Translate = (key: MessageKey, params?: MessageParams) => string

// Only recognize engine-prefixed errors in old logs; source text may contain parentheses.
const engineName = '(?:agent:[^\\s:;()]+|apple|bergamot|google|bing|ollama)'
const enginePrefix = `${engineName}:\\s*`

export function readTranslationFailure(text: string): TranslationFailureLog | undefined {
  if (!text.startsWith('Translation failed: ') || !text.endsWith(')')) return undefined
  const body = text.slice('Translation failed: '.length, -1)
  const start = new RegExp(` \\((?=${enginePrefix})`).exec(body)
  if (!start) return undefined
  return { source: body.slice(0, start.index), error: body.slice(start.index + 2) }
}

function failureReason(engine: string, error: string, t: Translate): string {
  if (engine === 'apple' && error.startsWith('Apple offline language pack not installed')) return t('translate.failureApplePack')
  if (engine === 'bergamot' && error.startsWith('Language pack not installed:')) return t('translate.failureBergamotPack')
  if (error === 'No valid translation returned or control tokens missing') return t('translate.failureLegacyValidation')
  if (error === 'Translation control tokens missing') return t('translate.failureMissingControls')
  if (error === 'No valid translation returned' || error === 'no translation returned') return t('translate.failureInvalidTranslation')
  return error
}

export function formatTranslationFailure(failure: TranslationFailureLog, t: Translate): string {
  const reasons = failure.error.split(new RegExp(`;\\s*(?=${enginePrefix})`)).map((part) => {
    const match = new RegExp(`^(${engineName}):\\s*([\\s\\S]*)$`).exec(part)
    if (!match) return failureReason('', part, t)
    const engine = match[1]
    const pair = /^\[([a-zA-Z][\w-]* -> [a-zA-Z][\w-]*)\] ([\s\S]*)$/.exec(match[2])
    const error = pair ? pair[2] : match[2]
    // Old Bergamot diagnostics retain the requested pair in the missing config path.
    const legacyPair = engine === 'bergamot' ? /^Language pack not installed: .*[/\\]([a-zA-Z-]+)_([a-zA-Z-]+)[/\\]config\.yml$/.exec(error) : null
    const languages = pair ? pair[1].replace(' -> ', ' → ') : legacyPair ? `${legacyPair[1]} → ${legacyPair[2]}` : ''
    const name = { apple: 'Apple', bergamot: 'Bergamot', google: 'Google', bing: 'Bing', ollama: 'Ollama' }[engine] ?? engine
    const label = engine.startsWith('agent:') ? `Agent (${engine.slice(6)}${languages ? ` · ${languages}` : ''})` : `${name}${languages ? ` (${languages})` : ''}`
    return t('translate.failureLogEngine', { engine: label, reason: failureReason(engine, error, t) })
  })
  return t('translate.failureLog', { source: failure.source, reasons: reasons.join('\n') })
}
