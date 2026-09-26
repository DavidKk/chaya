import { formCard, formControl, formControlInline, formField, formFieldInline } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'

/** 游戏库页初始加载：对齐 LibraryRail + 首页头卡（快捷入口/操作）+ DashboardSettings。 */
export function LibraryPageSkeleton() {
  return (
    <SkeletonRegion label="加载游戏库" className="flex min-h-0 flex-1 items-stretch gap-0 border-t border-line">
      <aside className="hidden w-[20.5rem] shrink-0 flex-col min-h-0 border-r border-line bg-paper-2 md:flex" aria-hidden>
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line py-0 pr-[0.65rem] pl-4">
          <Skeleton className="h-[0.8125rem] w-14" />
          <Skeleton className="size-8 shrink-0 rounded-[0.25rem]" />
        </div>
        <ul className="m-0 flex list-none flex-col gap-[0.65rem] p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i}>
              <div className="relative flex flex-col gap-[0.35rem] rounded-[0.45rem] border border-line bg-panel px-[0.65rem] pt-[0.7rem] pb-[0.65rem]">
                <div className="flex w-full items-center gap-[0.65rem] pr-[1.35rem]">
                  <Skeleton className="size-[2.15rem] shrink-0 rounded-[0.35rem]" />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.35rem]">
                    <Skeleton className="h-[0.9rem]" style={{ width: `${52 + (i % 3) * 14}%` }} />
                    <div className="flex flex-wrap items-center gap-x-[0.55rem] gap-y-[0.35rem]">
                      <Skeleton className="h-[0.72rem] w-12" />
                      <Skeleton className="h-[0.72rem] w-10" />
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-5 pt-4 pb-5" aria-hidden>
        <div className="mb-3 flex shrink-0 items-center md:hidden">
          <Skeleton className="size-8 rounded-[0.2rem]" />
        </div>
        <div className="flex w-full max-w-[48rem] flex-col gap-4">
          <div className="flex flex-col items-stretch gap-5 rounded-[0.4rem] border border-line bg-panel px-5 py-5">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="size-7 shrink-0 rounded-[0.3rem]" />
                <Skeleton className="h-6 w-[38%]" />
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
                <Skeleton className="h-[0.75rem] w-16" />
                <Skeleton className="h-[0.75rem] w-14" />
                <Skeleton className="h-[0.75rem] w-20" />
                <Skeleton className="h-[0.75rem] w-12" />
                <Skeleton className="h-[0.75rem] w-[4.5rem]" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-[var(--line-soft)] pt-4">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex min-w-0 items-center gap-3 rounded-[0.4rem] border border-line bg-inset px-3.5 py-3">
                  <Skeleton className="size-10 shrink-0 rounded-[0.35rem]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Skeleton className="h-[0.875rem] w-10" />
                    <Skeleton className="h-[0.72rem] w-[88%]" />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-start gap-3 border-t border-[var(--line-soft)] pt-4">
              <Skeleton className="h-11 min-w-[11rem] w-[11rem] rounded-[0.3rem]" />
              <Skeleton className="h-11 min-w-[11rem] w-[11rem] rounded-[0.3rem]" />
            </div>
          </div>

          <div className={formCard}>
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className={formField}>
                <Skeleton className="h-[0.8125rem] w-10" />
                <Skeleton className="h-[0.7rem] w-[72%]" />
                <div className={formControl}>
                  <Skeleton className="h-8 min-w-0 flex-1 rounded-[0.25rem]" />
                  <Skeleton className="size-8 shrink-0 rounded-[0.25rem]" />
                  <Skeleton className="size-8 shrink-0 rounded-[0.25rem]" />
                </div>
              </div>
            ))}
            <div className={formFieldInline}>
              <div className="col-start-1 row-start-1 flex flex-col gap-[0.2rem]">
                <Skeleton className="h-[0.8125rem] w-16" />
                <Skeleton className="h-[0.7rem] w-24" />
              </div>
              <div className={formControlInline}>
                <Skeleton className="h-8 w-[11rem] rounded-[0.25rem]" />
              </div>
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={formFieldInline}>
                <div className="col-start-1 row-span-2 row-start-1 flex flex-col gap-[0.2rem]">
                  <Skeleton className="h-[0.8125rem]" style={{ width: `${5.5 + (i % 3) * 1.25}rem` }} />
                  <Skeleton className="h-[0.7rem]" style={{ width: `${7 + (i % 2) * 2}rem` }} />
                </div>
                <div className={formControlInline}>
                  <Skeleton className="h-5 w-9 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}
