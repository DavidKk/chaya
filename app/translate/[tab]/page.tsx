import { notFound, redirect } from 'next/navigation'

import { TRANSLATE_TABS } from '@/components/translate/tabs'
import { TranslateTabView } from '@/components/translate/TranslateTabView'

type Props = { params: Promise<{ tab: string }> }

export function generateStaticParams() {
  return TRANSLATE_TABS.map((t) => ({ tab: t.id }))
}

export default async function TranslateTabPage({ params }: Props) {
  const { tab: raw } = await params
  if (raw === 'run') {
    redirect('/translate/seed')
  }
  const tab = TRANSLATE_TABS.find((item) => item.id === raw)?.id
  if (!tab) notFound()
  return <TranslateTabView tab={tab} />
}
