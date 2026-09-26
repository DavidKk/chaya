'use client'

import { usePathname } from 'next/navigation'

import { useT } from '@/components/i18n/LocaleProvider'
import { parseTranslateTab } from '@/components/translate/tabs'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { TranslateLayoutShell } from '@/components/translate/TranslateLayoutShell'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'

/** 绑定状态未就绪时：保留翻译壳 + 当前 tab 的数据骨架（勿用居中选游戏钮骨架） */
export function TranslateBoundLoading() {
  const t = useT()
  const pathname = usePathname() || ''
  const seg = pathname.split('/').filter(Boolean).pop()
  const tab = parseTranslateTab(seg === 'translate' ? undefined : seg)
  return <TranslateLayoutShell>{tab === 'cache' ? <TranslateCacheTableSkeleton label={t('translate.loadCache')} /> : <TranslateRunSkeleton />}</TranslateLayoutShell>
}
