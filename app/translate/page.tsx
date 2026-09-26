import { redirect } from 'next/navigation'

import { DEFAULT_TRANSLATE_TAB, translateTabHref } from '@/components/translate/tabs'

export default function TranslateIndexPage() {
  redirect(translateTabHref(DEFAULT_TRANSLATE_TAB))
}
