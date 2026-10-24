'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense, formControlInline, formFieldInlineDense, panelFoot } from '@/components/layoutClasses'
import { PanelHeadEnd } from '@/components/PanelHeadEnd'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import type { TranslateRunMode } from '@/components/translate/tabs'
import { cn } from '@/lib/utils'

type TranslateModeTab = TranslateRunMode

function ToggleSettingSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-[0.8125rem] w-24" />
        <Skeleton className="h-[0.7rem] w-[68%]" />
      </div>
      <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
    </div>
  )
}

function InlineSettingSkeleton({ control = 'switch' }: { control?: 'switch' | 'input' }) {
  return (
    <div className={formFieldInlineDense}>
      <Skeleton className="h-[0.8125rem] w-16" />
      <Skeleton className="h-[0.7rem] w-[70%]" />
      <div className={formControlInline}>
        <Skeleton className={control === 'switch' ? 'h-5 w-9 rounded-full' : 'h-8 w-full rounded-[0.25rem]'} />
      </div>
    </div>
  )
}

function ActivityLogSkeleton() {
  const t = useT()
  return (
    <div className="mt-4 flex w-full flex-col overflow-hidden rounded-[0.35rem] border border-line bg-panel" aria-label={t('translate.loadActivity')}>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <Skeleton className="h-[0.8125rem] w-20" />
          <Skeleton className="h-[0.7rem] w-28" />
        </div>
        <Skeleton className="mt-2 h-[0.75rem] w-[58%]" />
      </div>
      <div className="border-t border-[var(--line-soft)] p-3">
        <div className="flex h-[28rem] flex-col gap-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-[0.65rem] w-14 shrink-0" />
              <Skeleton className="h-[0.65rem]" style={{ width: `${42 + ((i * 13) % 48)}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PlaySettingsSkeleton() {
  const t = useT()
  return (
    <div aria-label={t('translate.loadPlaySettings')}>
      <div className={cn(formCardDense, 'm-0 w-full')}>
        <ToggleSettingSkeleton />
        <ToggleSettingSkeleton />
        <InlineSettingSkeleton control="input" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-[8.5rem] rounded-[0.25rem]" />
        </div>
      </div>
      <ActivityLogSkeleton />
    </div>
  )
}

function SeedProgressSkeleton() {
  const t = useT()
  return (
    <div aria-label={t('translate.loadSeedProgress')}>
      <div className={cn(formCardDense, 'w-full')}>
        <ToggleSettingSkeleton />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-[0.3rem] bg-inset/80 px-4 py-3">
              <Skeleton className="h-[0.6875rem] w-12" />
              <Skeleton className="mt-2 h-[1.35rem] w-16" />
              <Skeleton className="mt-2 h-[0.6875rem]" style={{ width: `${58 + (i % 3) * 11}%` }} />
            </div>
          ))}
        </div>
        <div>
          <div className="mb-2 flex justify-between gap-3">
            <Skeleton className="h-[0.7rem] w-32" />
            <Skeleton className="h-[0.7rem] w-9" />
          </div>
          <Skeleton className="h-2.5 w-full rounded-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-[0.2rem]" />
            <Skeleton className="h-8 w-24 rounded-[0.2rem]" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-16 rounded-[0.2rem]" />
            <Skeleton className="h-8 w-16 rounded-[0.2rem]" />
            <Skeleton className="h-8 w-16 rounded-[0.2rem]" />
          </div>
        </div>
      </div>
      <ActivityLogSkeleton />
    </div>
  )
}

/** 翻译列表页骨架屏：页头筛选、语向/批量工具栏、条目行和分页页脚。 */
export function TranslateListSkeleton() {
  const t = useT()
  const filters = (
    <div className="flex flex-nowrap items-center justify-end gap-2" aria-hidden>
      <Skeleton className="h-8 w-48 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-24 shrink-0 rounded-[0.2rem]" />
    </div>
  )
  return (
    <SkeletonRegion label={t('translate.loadList')} className="flex h-full min-h-0 w-full flex-col select-none">
      <PanelHeadEnd fallback={filters}>{filters}</PanelHeadEnd>

      <div className="shrink-0 border-b border-line bg-surface/10">
        <div className="flex min-w-max flex-nowrap items-center justify-end gap-2 px-4 py-2" aria-hidden>
          <Skeleton className="h-8 w-[13rem] shrink-0 rounded-[0.25rem]" />
          <Skeleton className="h-8 w-36 shrink-0 rounded-[0.2rem]" />
          <div className="mx-0.5 h-3.5 w-px shrink-0 bg-line" />
          <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
          <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
          <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
          <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden divide-y divide-line">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex h-[150px] min-w-0 flex-col" aria-hidden>
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/20 px-4 text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <Skeleton className="h-4 w-8 rounded-[0.2rem]" />
                <Skeleton className="h-4 w-16 rounded-[0.2rem]" />
                <Skeleton className="h-4 w-12 rounded-[0.2rem]" />
                <Skeleton className="h-4 w-24 rounded-[0.2rem]" />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Skeleton className="h-6 w-12 rounded-[0.2rem]" />
                <Skeleton className="h-6 w-12 rounded-[0.2rem]" />
              </div>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2">
              <div className="flex min-w-0 flex-col justify-center border-r border-b border-line bg-black/40 px-4 py-3">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="mt-2 h-3 w-3/5" />
              </div>
              <div className="flex min-w-0 flex-col justify-center border-b border-line bg-panel/35 px-4 py-3">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="mt-2 h-3 w-2/4" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={cn(panelFoot, 'max-md:justify-center')} aria-hidden>
        <div className="hidden items-center gap-2 md:flex">
          <Skeleton className="h-3.5 w-48" />
        </div>
        <div className="inline-flex items-center gap-1.5">
          <Skeleton className="h-7 w-[4.75rem] rounded-[0.2rem]" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** 翻译运行页加载态：与 seed/play 的卡片、操作栏和活动日志同构。 */
export function TranslateRunSkeleton({ tab = 'seed' }: { tab?: TranslateModeTab }) {
  const t = useT()
  if (tab === 'list') return <TranslateListSkeleton />

  const label = tab === 'seed' ? t('translate.loadSeed') : t('translate.loadPlay')
  return (
    <SkeletonRegion label={label} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-start justify-start overflow-hidden p-4">
        <div className="flex w-full max-w-[52rem] flex-col gap-3">{tab === 'seed' ? <SeedProgressSkeleton /> : <PlaySettingsSkeleton />}</div>
      </div>
    </SkeletonRegion>
  )
}
