import type { MessageKey } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n/locales'

import { DISCLAIMER, DISCLAIMER_UPDATED } from './disclaimer'
import { LICENSE_DOC } from './license'
import { PRIVACY } from './privacy'
import type { LegalDoc } from './types'

export type LegalDocId = 'disclaimer' | 'privacy' | 'license'

export type LegalDocEntry = {
  href: `/${string}`
  titleKey: MessageKey
  /** 改动正文时同步更新 */
  updated: string
  content: Record<Locale, LegalDoc>
}

export const LEGAL_DOC_IDS = ['disclaimer', 'privacy', 'license'] as const satisfies readonly LegalDocId[]

export const LEGAL_DOCS: Record<LegalDocId, LegalDocEntry> = {
  disclaimer: { href: '/disclaimer', titleKey: 'legal.title', updated: DISCLAIMER_UPDATED, content: DISCLAIMER },
  privacy: { href: '/privacy', titleKey: 'legal.privacy', updated: '2026-10-06', content: PRIVACY },
  license: { href: '/license', titleKey: 'legal.license', updated: '2026-10-06', content: LICENSE_DOC },
}

export const LEGAL_HREFS: ReadonlySet<string> = new Set(LEGAL_DOC_IDS.map((id) => LEGAL_DOCS[id].href))

export type { LegalDoc, LegalSection } from './types'
