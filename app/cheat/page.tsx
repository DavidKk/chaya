import { redirect } from 'next/navigation'

import { DEFAULT_TAB, editTabHref } from '@/components/game-edit'

export default function CheatIndexRoute() {
  redirect(editTabHref(DEFAULT_TAB))
}
