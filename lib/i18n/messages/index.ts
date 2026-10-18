import type { Locale } from '@/lib/i18n/locales'
import { cht } from '@/lib/i18n/messages/cht'
import { de } from '@/lib/i18n/messages/de'
import { en } from '@/lib/i18n/messages/en'
import { es } from '@/lib/i18n/messages/es'
import { fr } from '@/lib/i18n/messages/fr'
import { ja } from '@/lib/i18n/messages/ja'
import { ko } from '@/lib/i18n/messages/ko'
import { ptBR } from '@/lib/i18n/messages/ptBR'
import { ru } from '@/lib/i18n/messages/ru'
import { type MessageTree, zh } from '@/lib/i18n/messages/zh'

export const MESSAGES: Record<Locale, MessageTree> = {
  zh,
  cht,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  ru,
  'pt-BR': ptBR,
}

export type { MessageTree }
