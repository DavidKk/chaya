import type { Locale } from '@/lib/i18n/locales'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import { ko } from '@/lib/i18n/messages/ko'
import { type MessageTree, zh } from '@/lib/i18n/messages/zh'

export const MESSAGES: Record<Locale, MessageTree> = {
  zh,
  en,
  ja,
  ko,
}

export type { MessageTree }
