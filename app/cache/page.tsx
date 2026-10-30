import { redirect } from 'next/navigation'

import { translateTabHref } from '@/components/translate/tabs'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

/** 旧路径兼容：`/cache` → `/translate/cache` */
export default async function CacheRedirectPage({ searchParams }: Props = {}) {
  const query = searchParams ? await searchParams : {}
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
    else if (typeof value === 'string') next.set(key, value)
  }
  const qs = next.toString()
  const href = translateTabHref('cache')
  redirect(qs ? `${href}?${qs}` : href)
}
