import { notFound, redirect } from 'next/navigation'

import { TRANSLATE_TABS } from '@/components/translate/tabs'
import { TranslateTabView } from '@/components/translate/TranslateTabView'

type Props = {
  params: Promise<{ tab: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export function generateStaticParams() {
  return TRANSLATE_TABS.map((t) => ({ tab: t.id }))
}

export default async function TranslateTabPage({ params, searchParams }: Props) {
  const [{ tab: raw }, query] = await Promise.all([params, searchParams ? searchParams : Promise.resolve({})])
  if (raw === 'run') {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue
      if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
      else if (typeof value === 'string') next.set(key, value)
    }
    const qs = next.toString()
    redirect(qs ? `/translate/seed?${qs}` : '/translate/seed')
  }
  const tab = TRANSLATE_TABS.find((item) => item.id === raw)?.id
  if (!tab) notFound()
  return <TranslateTabView tab={tab} />
}
