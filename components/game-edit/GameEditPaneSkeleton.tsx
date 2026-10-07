'use client'

import { usePathname, useRouter } from 'next/navigation'

import { useT } from '@/components/i18n/LocaleProvider'
import {
  formCardDense,
  formControlInline,
  formFieldInlineDense,
  padXDense,
  padYDense,
  pageMainFlush,
  panelBody,
  panelFoot,
  panelHead,
  panelHeadEnd,
  panelShell,
} from '@/components/layoutClasses'
import { LogEntriesSkeleton } from '@/components/LogEntriesView'
import { EditTableSkeleton, Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import type { TranslateTabId } from '@/components/translate/tabs'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { cn } from '@/lib/utils'

import { EventsPaneSkeleton } from './events/EventsSkeleton'
import { GameEditTabNav } from './GameEditTabNav'
import { SaveDataPaneSkeleton } from './save-data/SaveDataSkeleton'
import { editTabHref, parseTabId, type TabId } from './tabs'

/** 从 `/cheat/...` 路径解析当前修改 tab（绑定骨架用） */
export function parseGameEditTabFromPath(pathname: string): TabId {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'cheat') return 'run'
  return parseTabId(parts[1], 'run')
}

function FormFieldRowSkeleton({ controlW = '7.25rem' }: { controlW?: string }) {
  return (
    <div className={formFieldInlineDense} aria-hidden>
      <Skeleton className="h-[0.8125rem] w-14" />
      <Skeleton className="h-[0.7rem] w-[55%]" />
      <div className={formControlInline}>
        <Skeleton className="h-8 rounded-[0.25rem]" style={{ width: controlW }} />
      </div>
    </div>
  )
}

/** 页头右侧：与真实筛选/刷新轨对齐 */
function GameEditHeadEndSkeleton({ tab }: { tab: TabId }) {
  const showTableFilters = tab !== 'run' && tab !== 'trans'
  return (
    <div className={cn(panelHeadEnd, 'h-8 min-h-0 min-w-0 flex-1 shrink overflow-hidden')} aria-hidden>
      <div className="ml-auto inline-flex h-8 w-max flex-nowrap items-center justify-end gap-2 pr-0.5 pl-1">
        {showTableFilters ? (
          <>
            <Skeleton className="h-8 w-[11rem] shrink-0 rounded-[0.15rem]" />
            {tab !== 'actor' ? <Skeleton className="h-8 w-[3.75rem] shrink-0 rounded-[0.2rem]" /> : null}
            <Skeleton className="h-8 w-[3.75rem] shrink-0 rounded-[0.2rem]" />
          </>
        ) : null}
        <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
      </div>
    </div>
  )
}

function PanelHeadTitleSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1" aria-hidden>
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="h-3 w-48 max-w-full" />
    </div>
  )
}

/** 运行设置：表单卡 + 开关行 + 动作钮格 */
export function GameEditRunSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadRun')} className="min-h-0 flex-1 overflow-hidden">
      <div className="flex flex-wrap items-start gap-2 px-4 pt-3 pb-4" aria-hidden>
        <div className={cn(formCardDense, 'm-0 w-full max-w-[36rem]')}>
          {Array.from({ length: 4 }, (_, i) => (
            <FormFieldRowSkeleton key={`cfg-${i}`} controlW={i === 0 ? '7.25rem' : '11rem'} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <FormFieldRowSkeleton key={`sw-${i}`} controlW="2.75rem" />
          ))}
        </div>
        <div className={cn(formCardDense, 'm-0 w-full max-w-[36rem]')}>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="mt-2 h-3 w-[70%]" />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-[0.2rem]" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** 快捷键：分组卡 + 双绑定框行 */
export function GameEditHotkeysSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadHotkeys')} className="min-h-0 flex-1 overflow-hidden">
      <div className="flex flex-col gap-3 px-4 pt-3 pb-4" aria-hidden>
        {Array.from({ length: 2 }, (_, g) => (
          <div key={g} className={cn(formCardDense, 'm-0 w-full max-w-[64rem]')}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-[0.68rem] w-12" />
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="h-[0.68rem] w-[9.5rem]" />
                <Skeleton className="h-[0.68rem] w-[9.5rem]" />
              </div>
            </div>
            {Array.from({ length: g === 0 ? 4 : 5 }, (_, i) => (
              <div key={i} className={cn(formFieldInlineDense, 'grid-cols-[minmax(12rem,1fr)_auto]')}>
                <Skeleton className="h-[0.8125rem] w-16" />
                <Skeleton className="h-[0.7rem] w-[40%]" />
                <div className={cn(formControlInline, 'gap-2')}>
                  <Skeleton className="h-8 w-[9.5rem] rounded-[0.15rem]" />
                  <Skeleton className="h-8 w-[9.5rem] rounded-[0.15rem]" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/** 角色：左人物列表 + 右表单 */
export function GameEditActorSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadActor')} className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-[15rem] shrink-0 flex-col border-r border-line bg-paper-2 sm:w-[17rem]" aria-hidden>
        <div className={cn('shrink-0 border-b border-line', padXDense, padYDense)}>
          <Skeleton className="h-[0.68rem] w-16" />
        </div>
        <div className="flex flex-col gap-0.5 p-1">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={cn('flex items-center', padXDense, padYDense)}>
              <Skeleton className="h-[0.875rem]" style={{ width: `${48 + (i % 4) * 12}%` }} />
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-hidden>
        <div className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-4">
          <Skeleton className="h-8 w-14 rounded-[0.2rem]" />
          <Skeleton className="h-8 w-14 rounded-[0.2rem]" />
          <Skeleton className="h-8 w-14 rounded-[0.2rem]" />
        </div>
        <div className="px-4 pt-3 pb-4">
          <div className={cn(formCardDense, 'm-0 max-w-[32rem]')}>
            {Array.from({ length: 6 }, (_, i) => (
              <FormFieldRowSkeleton key={i} controlW={i < 2 ? '14rem' : '7.25rem'} />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** 日志：筛选内容头部 + 四列表格 + 状态页脚。 */
export function GameEditLogsSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadLogs')} className="flex min-h-0 flex-1 flex-col">
      <div className={panelHead} aria-hidden>
        <PanelHeadTitleSkeleton />
        <div className={panelHeadEnd}>
          <Skeleton className="h-8 w-52 min-w-[5.5rem] shrink rounded-[0.2rem]" />
          <Skeleton className="h-8 w-[15.5rem] min-w-[9.5rem] shrink rounded-[0.2rem]" />
          <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
          <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
        </div>
      </div>
      <LogEntriesSkeleton label={t('edit.loadLogsList')} />
      <div className={panelFoot} aria-hidden>
        <Skeleton className="h-[0.7rem] w-40" />
        <Skeleton className="h-[0.7rem] w-14" />
      </div>
    </SkeletonRegion>
  )
}

/** 翻译：分区内容头部 + 当前分区对应内容。 */
export function GameEditTransSkeleton({ section = 'run', translateTab = 'play', label }: { section?: TranslateTabId; translateTab?: 'play' | 'seed'; label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadTrans')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row" aria-hidden>
        <aside className="shrink-0 border-b border-line bg-paper md:w-[3.75rem] md:border-r md:border-b-0">
          <div className="flex gap-1 p-2 md:flex-col">
            <Skeleton className="size-11 rounded-[0.35rem]" />
            <Skeleton className="size-11 rounded-[0.35rem]" />
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={panelHead}>
            <PanelHeadTitleSkeleton />
            {section === 'cache' ? (
              <div className={panelHeadEnd}>
                <Skeleton className="h-8 w-52 min-w-[5.5rem] shrink rounded-[0.2rem]" />
                <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
                <Skeleton className="h-8 w-[4.5rem] shrink-0 rounded-[0.2rem]" />
              </div>
            ) : null}
          </div>
          <div className={panelBody}>{section === 'cache' ? <TranslateCacheTableSkeleton /> : <TranslateRunSkeleton tab={translateTab} />}</div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** 按 tab 选骨架：列表用表；运行 / 快捷键 / 角色用各自布局 */
export function GameEditPaneSkeleton({
  tab,
  label,
  translateSection,
  translateTab,
}: {
  tab: TabId
  label?: string
  translateSection?: TranslateTabId
  translateTab?: 'play' | 'seed'
}) {
  const t = useT()
  if (tab === 'run') return <GameEditRunSkeleton label={label ?? t('edit.loadRun')} />
  if (tab === 'actor') return <GameEditActorSkeleton label={label ?? t('edit.loadActor')} />
  if (tab === 'trans') return <GameEditTransSkeleton section={translateSection} translateTab={translateTab} label={label} />
  if (tab === 'logs') return <GameEditLogsSkeleton label={label ?? t('edit.loadLogs')} />
  if (tab === 'common' || tab === 'map' || tab === 'troop') return <EventsPaneSkeleton label={label} head={tab} />
  if (tab === 'data') return <SaveDataPaneSkeleton label={label} />
  return <EditTableSkeleton label={label ?? t('edit.loadCatalog')} />
}

/** 绑定门闸加载：二级导航真壳 + 右侧工具轨骨架 + 当前 tab 内容骨架 */
export function GameEditBoundLoading() {
  const pathname = usePathname() || ''
  const router = useRouter()
  const t = useT()
  const tab = parseGameEditTabFromPath(pathname)
  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="status" aria-label={t('edit.loadEdit')}>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <GameEditTabNav tab={tab} setTab={(next) => router.push(editTabHref(next))} surface="page" />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={panelHead}>
              <PanelHeadTitleSkeleton />
              <GameEditHeadEndSkeleton tab={tab} />
            </div>
            <div className={tab === 'trans' || tab === 'logs' ? 'flex min-h-0 flex-1 flex-col' : panelBody}>
              <GameEditPaneSkeleton tab={tab} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
