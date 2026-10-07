'use client'

import type { DragEvent, ReactNode } from 'react'
import { GrFormEdit } from 'react-icons/gr'
import { LuGripVertical } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { SwitchToggle, TruncateText } from '@/components/sk'
import { controlDisabled } from '@/components/sk/control'
import { cn } from '@/lib/utils'

type Props = {
  label: string
  subtitle?: string
  checked: boolean
  /** 交互锁（加载 / 保存中 / 外部禁用） */
  locked: boolean
  dragging: boolean
  dropEdge: 'before' | 'after' | null
  actions?: ReactNode
  /** 有值时标题可点（后接编辑图标），点击展开 / 收起配置 */
  onEdit?: () => void
  editing?: boolean
  children?: ReactNode
  onToggle: (checked: boolean) => void
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent<HTMLLIElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLLIElement>) => void
}

/** 翻译引擎栏一行：拖拽柄 + 名称 + 操作 + 开关；children 为展开的配置区 */
export function TranslateEngineRow({
  label,
  subtitle,
  checked,
  locked,
  dragging,
  dropEdge,
  actions,
  onEdit,
  editing = false,
  children,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
  const t = useT()
  return (
    <li
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col rounded-[0.35rem] border border-line bg-panel transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out',
        dragging ? 'scale-[0.985] opacity-40 shadow-none' : 'hover:border-[color-mix(in_oklab,var(--line)_70%,var(--accent))]'
      )}
    >
      {dropEdge ? (
        <span
          className={cn('pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]', dropEdge === 'before' ? '-top-1' : '-bottom-1')}
        />
      ) : null}
      <div className={cn('grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-1 pr-3 pl-0', subtitle ? 'h-12' : 'h-11')}>
        <button
          type="button"
          draggable={!locked}
          disabled={locked}
          aria-label={t('translate.dragEngine', { name: label })}
          title={t('translate.dragOrder')}
          className={cn(
            'inline-flex h-full w-full cursor-grab appearance-none items-center justify-center border-none bg-transparent p-0 text-ink-soft/70',
            'hover:enabled:text-ink active:cursor-grabbing',
            controlDisabled
          )}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <LuGripVertical size={12} aria-hidden />
        </button>
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          {onEdit ? (
            <button
              type="button"
              aria-expanded={editing}
              aria-label={t('translate.agentEdit', { name: label })}
              className={cn(
                'group/edit relative inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-left text-[0.8125rem] leading-[1.4]',
                'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:bg-current after:opacity-0 after:content-[""] hover:after:opacity-100',
                editing ? 'text-accent' : 'text-ink'
              )}
              onClick={onEdit}
            >
              <TruncateText text={label} className="font-medium" />
              <GrFormEdit size={16} aria-hidden className={cn('-mx-1 shrink-0', editing ? 'text-accent' : 'text-ink-soft group-hover/edit:text-ink')} />
            </button>
          ) : (
            <TruncateText text={label} className="text-[0.8125rem] font-medium leading-[1.4] text-ink" />
          )}
          {subtitle ? <TruncateText text={subtitle} className="text-[0.7rem] leading-[1.4] text-ink-soft" /> : null}
        </div>
        <div className="flex h-full items-center justify-center gap-1">
          {actions}
          <SwitchToggle checked={checked} disabled={locked} aria-label={t('translate.engineToggle', { name: label })} onCheckedChange={onToggle} />
        </div>
      </div>
      {children ? <div className="border-t border-line px-3 pt-2 pb-3">{children}</div> : null}
    </li>
  )
}
