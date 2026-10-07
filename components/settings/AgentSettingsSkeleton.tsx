import { formCard, formControlInline, formFieldInline, panelHead, settingsCardWide } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion } from '@/components/sk'

const LIST_ROWS = 3
const DETAIL_FIELDS = 6

export function AgentListSkeleton({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <SkeletonRegion label={label} className="w-full max-w-3xl overflow-hidden rounded-md border border-line bg-panel">
          <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-8 w-24 shrink-0" />
          </div>
          <div className="flex flex-col divide-y divide-line">
            {Array.from({ length: LIST_ROWS }, (_, row) => (
              <div key={row} className="flex items-center gap-3 px-3 py-3">
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Skeleton className="h-3.5" style={{ width: `${28 + (row % 3) * 8}%` }} />
                  <Skeleton className="h-3" style={{ width: `${56 + (row % 2) * 12}%` }} />
                </div>
                <div className="flex shrink-0 items-center gap-px">
                  <Skeleton className="size-8" />
                  <Skeleton className="size-8" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </div>
  )
}

export function AgentDetailSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="flex min-h-0 flex-1 flex-col">
      <div className={panelHead}>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className={settingsCardWide}>
          <div className={formCard}>
            {Array.from({ length: DETAIL_FIELDS }, (_, row) => (
              <div key={row} className={formFieldInline}>
                <div className="col-start-1 row-span-2 row-start-1 grid gap-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  {row ? <Skeleton className="h-3 w-32 max-w-full" /> : null}
                </div>
                <div className={formControlInline}>
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-8 w-20" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}
