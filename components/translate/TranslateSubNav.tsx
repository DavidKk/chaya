'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { LuSlidersHorizontal } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { PanelHeadEndHost } from '@/components/PanelHeadEnd'
import { Button, SegmentedNav } from '@/components/sk'
import { DEFAULT_TRANSLATE_TAB, TRANSLATE_TABS, translateTabHref, type TranslateTabId } from '@/components/translate/tabs'
import { useTranslateEnginesDrawer } from '@/components/translate/TranslateEnginesDrawerContext'
import { cn } from '@/lib/utils'

type Props = {
  tab: TranslateTabId
  className?: string
}

/** 翻译区二级导航：左 tabs（+ 小屏引擎轨按钮），右筛选槽由内容页 `PanelHeadEnd` 注入 */
export function TranslateSubNav({ tab, className }: Props) {
  const t = useT()
  const router = useRouter()
  const { open, setOpen } = useTranslateEnginesDrawer()
  const showEnginesTrigger = (tab || DEFAULT_TRANSLATE_TAB) === 'run'
  const items = useMemo(() => TRANSLATE_TABS.map((item) => ({ id: item.id, label: t(item.labelKey) })), [t])

  useEffect(() => {
    if (!showEnginesTrigger) setOpen(false)
  }, [showEnginesTrigger, setOpen])

  return (
    <div className={cn(panelHead, className)}>
      {showEnginesTrigger ? (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('translate.platforms')}
          tooltip={t('translate.platforms')}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <LuSlidersHorizontal size={16} aria-hidden />
        </Button>
      ) : null}
      <SegmentedNav items={items} value={tab || DEFAULT_TRANSLATE_TAB} onChange={(id) => router.push(translateTabHref(id))} aria-label={t('translate.section')} />
      <PanelHeadEndHost />
    </div>
  )
}
