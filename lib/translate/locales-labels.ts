export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English (en)',
  ru: 'Русский (ru)',
  ch: '简体中文 (ch)',
  cht: '繁體中文 (cht)',
  zh: '简体中文 (zh)',
  'zh-cn': '简体中文 (zh-CN)',
  'zh-tw': '繁體中文 (zh-TW)',
  ja: '日本語 (ja)',
  ko: '한국어 (ko)',
  es: 'Español (es)',
  de: 'Deutsch (de)',
  fr: 'Français (fr)',
  it: 'Italiano (it)',
  pt: 'Português (pt)',
}

export function formatLanguageLabel(code: string): string {
  if (!code) return ''
  const normalized = code.toLowerCase()
  if (LANGUAGE_LABELS[normalized]) return LANGUAGE_LABELS[normalized]
  return code
}
