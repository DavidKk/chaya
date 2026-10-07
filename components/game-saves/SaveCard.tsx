'use client'

import type { ReactNode } from 'react'
import { LuInfo } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense, formFieldInlineDense } from '@/components/layoutClasses'
import { ScrollArea, Tooltip } from '@/components/sk'
import { cn } from '@/lib/utils'

/** 卡片设置区：每项一行，左侧标题与说明，右侧控件 */
export const settingsRows = cn(formCardDense, 'rounded-none border-x-0 border-t-0 bg-transparent [&>*]:px-4 [&>*+*]:before:inset-x-4')
export const settingsRow = cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto]')

type SaveCardProps = {
  id: string
  title: string
  description: string
  /** 标题旁信息图标的悬停说明 */
  hint?: ReactNode
  /** 标题行右侧，例如总开关 */
  action?: ReactNode
  children: ReactNode
}

/** 与键鼠工具分组一致的卡片：标题、说明，下方内容 */
export function SaveCard({ id, title, description, hint, action, children }: SaveCardProps) {
  const t = useT()
  return (
    <section className="w-full overflow-hidden rounded-md border border-line bg-panel" aria-labelledby={id}>
      <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 id={id} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {hint ? (
              <Tooltip content={<span className="block max-w-72 leading-[1.5]">{hint}</span>}>
                <button type="button" aria-label={t('saves.page.help', { title })} className="inline-flex cursor-help border-none bg-transparent p-0 text-ink-soft hover:text-ink">
                  <LuInfo size={14} aria-hidden />
                </button>
              </Tooltip>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-[1.35] text-ink-soft">{description}</p>
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** 列表上方的工具栏：左侧数量与占用，右侧列表操作 */
export function SaveListToolbar({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft tabular-nums">{summary}</span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** 存档列表：超过约 6 行后在卡片内滚动，使用自定义滚动条 */
export function SaveListScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ScrollArea className="max-h-[30rem]" scrollClassName="max-h-[30rem]" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': label }}>
      <div className="divide-y divide-line">{children}</div>
    </ScrollArea>
  )
}
