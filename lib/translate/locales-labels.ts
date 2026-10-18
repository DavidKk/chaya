export type CoreLanguage = {
  code: string
  label: string
}

export const CORE_TRANSLATION_LANGUAGES: CoreLanguage[] = [
  { code: 'en', label: 'English (en)' },
  { code: 'zh', label: '简体中文 (zh)' },
  { code: 'cht', label: '繁體中文 (cht)' },
  { code: 'ja', label: '日本語 (ja)' },
  { code: 'fr', label: 'Français (fr)' },
  { code: 'de', label: 'Deutsch (de)' },
  { code: 'es', label: 'Español (es)' },
  { code: 'ru', label: 'Русский (ru)' },
  { code: 'pt-BR', label: 'Português (pt-BR)' },
  { code: 'ko', label: '한국어 (ko)' },
]

export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English (en)',
  ru: 'Русский (ru)',
  ch: '简体中文 (ch)',
  cht: '繁體中文 (cht)',
  zh: '简体中文 (zh)',
  'zh-cn': '简体中文 (zh-CN)',
  'zh-tw': '繁體中文 (zh-TW)',
  'zh-hans': '简体中文 (zh-Hans)',
  'zh-hant': '繁體中文 (zh-Hant)',
  ja: '日本語 (ja)',
  ko: '한국어 (ko)',
  es: 'Español (es)',
  de: 'Deutsch (de)',
  fr: 'Français (fr)',
  it: 'Italiano (it)',
  pt: 'Português (pt)',
  'pt-br': 'Português (pt-BR)',
  'pt-pt': 'Português (pt-PT)',
}

export function formatLanguageLabel(code: string): string {
  if (!code) return ''
  const normalized = code.toLowerCase()
  if (LANGUAGE_LABELS[normalized]) return LANGUAGE_LABELS[normalized]
  return code
}
