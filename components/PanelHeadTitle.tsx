import type { ReactNode } from 'react'

import { TruncateText } from '@/components/sk/TruncateText'

/** 内容页头左侧的标题与单行说明；右侧空间不足时两行分别截断。 */
export function PanelHeadTitle({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <h2 className="m-0 flex min-w-0 text-sm font-semibold leading-tight text-ink">
        <TruncateText text={title} />
      </h2>
      <p className="m-0 flex min-w-0 text-xs leading-tight text-ink-soft">
        <TruncateText text={description} />
      </p>
    </div>
  )
}
