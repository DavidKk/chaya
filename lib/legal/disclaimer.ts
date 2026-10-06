import type { Locale } from '@/lib/i18n/locales'

import { disclaimerEn } from './disclaimer.en'
import { disclaimerJa } from './disclaimer.ja'
import { disclaimerKo } from './disclaimer.ko'
import { disclaimerZh } from './disclaimer.zh'
import type { LegalDoc } from './types'

export type DisclaimerDoc = LegalDoc

/** 改动正文时同步更新日期 */
export const DISCLAIMER_UPDATED = '2026-10-06'

export const DISCLAIMER: Record<Locale, DisclaimerDoc> = {
  zh: disclaimerZh,
  en: disclaimerEn,
  ja: disclaimerJa,
  ko: disclaimerKo,
}
