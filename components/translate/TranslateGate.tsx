'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, EmptyState } from '@/components/sk'
import { CACHE_TEST_COPY } from '@/components/translate/cache-test-copy'
import { translatePathTab } from '@/components/translate/tabs'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { useBoundGame } from '@/components/useBoundGame'

/**
 * 翻译内容区门闸：外壳 / 二级 tabs 始终展示；未选游戏或须连接时内容区为空态 + 入口。
 * 共享翻译库只读本机库，不要求选中游戏。翻译动作仍要本机游戏（磁盘接口）或已连接的云端游戏。
 */
export function TranslateGate({ children }: { children: ReactNode }) {
  const t = useT()
  const copy = CACHE_TEST_COPY[useLocaleCode()]
  const pathname = usePathname() || ''
  const tab = translatePathTab(pathname)
  const { access, cloud, busy, onChoose } = useBoundGame({ allowLocalOffline: true })

  if (tab === 'test' && cloud) return <EmptyState title={copy.intro} message={copy.diskOnly} />
  if (tab === 'test' || tab === 'cache' || access === 'ready') return children
  if (access === 'loading') {
    return <TranslateRunSkeleton />
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
