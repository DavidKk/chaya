import { notFound } from 'next/navigation'

import { TRANSLATE_TABS } from '@/components/translate/tabs'
import { TranslateTabView } from '@/components/translate/TranslateTabView'

type Props = { params: Promise<{ tab: string }> }

export function generateStaticParams() {
  return TRANSLATE_TABS.map((t) => ({ tab: t.id }))
}

export default async function TranslateTabPage({ params }: Props) {
  const { tab: raw } = await params
  if (!TRANSLATE_TABS.some((t) => t.id === raw)) notFound()
  return <TranslateTabView />
}
