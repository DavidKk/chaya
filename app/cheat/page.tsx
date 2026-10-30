import { redirect } from 'next/navigation'

import { DEFAULT_TAB, editTabHref } from '@/components/game-edit'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

export default async function CheatIndexRoute({ searchParams }: Props = {}) {
  const query = searchParams ? await searchParams : {}
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
    else if (typeof value === 'string') next.set(key, value)
  }
  const qs = next.toString()
  const href = editTabHref(DEFAULT_TAB)
  redirect(qs ? `${href}?${qs}` : href)
}
