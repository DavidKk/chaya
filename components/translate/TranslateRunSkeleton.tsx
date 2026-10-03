'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, formCardDense, formControlInline, formFieldInlineDense, panelFoot } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { cn } from '@/lib/utils'

type TranslateModeTab = 'play' | 'seed'

function EngineRailSkeleton() {
  return (
    <aside className="hidden w-[18.5rem] shrink-0 flex-col border-r border-line bg-paper-2 md:flex" aria-hidden>
      <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
        <Skeleton className="h-[0.8125rem] w-16" />
      </div>
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="grid h-11 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-1 rounded-[0.35rem] border border-line bg-panel pr-3 pl-0">
            <Skeleton className="mx-auto size-3 rounded-[0.15rem]" />
            <Skeleton className="h-[0.8125rem] w-14" />
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </div>
    </aside>
  )
}

function InlineSettingSkeleton({ control = 'switch' }: { control?: 'switch' | 'slider' }) {
  return (
    <div className={formFieldInlineDense}>
      <Skeleton className="h-[0.8125rem] w-16" />
      <Skeleton className="h-[0.7rem] w-[70%]" />
      <div className={formControlInline}>
        <Skeleton className={control === 'switch' ? 'h-5 w-9 rounded-full' : 'h-8 w-[7.25rem] rounded-[0.25rem]'} />
      </div>
    </div>
  )
}

function ActivityLogSkeleton() {
  const t = useT()
  return (
    <div className={cn(formCard, 'mt-4 w-full [&>*]:px-4 [&>*]:py-3')} aria-label={t('translate.loadActivity')}>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-[0.8125rem] w-16" />
        <Skeleton className="h-[0.7rem] w-24" />
      </div>
      <div>
        <Skeleton className="h-[0.7rem] w-[62%]" />
        <div className="mt-3 flex h-[11rem] flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-[0.65rem] w-14 shrink-0" />
              <Skeleton className="h-[0.65rem]" style={{ width: `${48 + i * 9}%` }} />
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
        <InlineSettingSkeleton />
        <InlineSettingSkeleton />
        <InlineSettingSkeleton control="slider" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-[8.5rem] rounded-[0.25rem]" />
          <Skeleton className="h-[0.7rem] w-20" />
        </div>
      </div>
      <ActivityLogSkeleton />
    </div>
  )
}

function SeedProgressSkeleton() {
  const t = useT()
  return (
    <div className={cn(formCardDense, 'w-full')} aria-label={t('translate.loadSeedProgress')}>
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
      <div className="flex flex-wrap items-center gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-[8.5rem] rounded-[0.3rem]" />
        ))}
      </div>
    </div>
  )
}

/** 翻译运行页加载态：保持引擎轨、配置子导航和当前模式内容的真实拓扑。 */
export function TranslateRunSkeleton({ tab = 'play' }: { tab?: TranslateModeTab }) {
  const t = useT()
  return (
    <SkeletonRegion label={tab === 'seed' ? t('translate.loadSeed') : t('translate.loadPlay')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-stretch">
        <EngineRailSkeleton />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-4 py-2" aria-hidden>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden" aria-hidden>
            <div className="flex items-start justify-start p-4">
              <div className="flex w-full max-w-[32rem] flex-col gap-3">{tab === 'seed' ? <SeedProgressSkeleton /> : <PlaySettingsSkeleton />}</div>
            </div>
          </div>
        </div>
      </div>
      {tab === 'seed' ? (
        <div className={panelFoot} aria-hidden>
          <Skeleton className="h-[0.7rem] w-48" />
          <Skeleton className="h-[0.7rem] w-24" />
        </div>
      ) : null}
    </SkeletonRegion>
  )
}
