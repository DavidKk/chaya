'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, EmptyState } from '@/components/sk'
import { parseTranslateTab } from '@/components/translate/tabs'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { useBoundGame } from '@/components/useBoundGame'

/**
 * 翻译内容区门闸：外壳 / 二级 tabs 始终展示；未选游戏或须连接时内容区为空态 + 入口。
 * 本机游戏选中即可用（磁盘接口），云端 / 远程游戏须连接。
 */
export function TranslateGate({ children }: { children: ReactNode }) {
  const t = useT()
  const pathname = usePathname() || ''
  const { access, cloud, busy, onChoose } = useBoundGame({ allowLocalOffline: true })

  if (access === 'ready') return children
  if (access === 'loading') {
    const seg = pathname.split('/').filter(Boolean).pop()
    const tab = parseTranslateTab(seg === 'translate' ? undefined : seg)
    return tab === 'cache' ? <TranslateCacheTableSkeleton label={t('translate.loadCache')} /> : <TranslateRunSkeleton />
  }
  const needGame = access === 'need-game'
  return (
    <EmptyState
      title={t(needGame ? 'translate.needGameTitle' : 'translate.needLinkTitle')}
      message={t(needGame ? (cloud ? 'translate.needGameCloudMsg' : 'translate.needGameMsg') : 'translate.needLinkMsg')}
    >
      <Button className="mt-3" loading={busy} onClick={onChoose}>
        {t(needGame ? 'common.chooseGame' : 'translate.openLibrary')}
      </Button>
    </EmptyState>
  )
}
