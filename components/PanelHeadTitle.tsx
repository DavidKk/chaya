import type { ReactNode } from 'react'

/** 内容页头左侧的标题与单行说明；右侧空间不足时两行分别截断。 */
export function PanelHeadTitle({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <h2 className="m-0 truncate text-sm font-semibold leading-tight text-ink">{title}</h2>
      <p className="m-0 truncate text-xs leading-tight text-ink-soft">{description}</p>
    </div>
  )
}
