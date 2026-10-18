import type { Locale } from '@/lib/i18n/locales'

import { privacyEn } from './privacy.en'
import { privacyJa } from './privacy.ja'
import { privacyKo } from './privacy.ko'
import { privacyZh } from './privacy.zh'
import type { LegalDoc } from './types'

export const PRIVACY: Record<Locale, LegalDoc> = {
  zh: privacyZh,
  cht: privacyZh,
  en: privacyEn,
  ja: privacyJa,
  ko: privacyKo,
  fr: privacyEn,
  de: privacyEn,
  es: privacyEn,
  ru: privacyEn,
  'pt-BR': privacyEn,
}
