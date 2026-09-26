'use client'

import { useEffect, useRef, useState } from 'react'
import { GrFormEdit } from 'react-icons/gr'

import { cn } from '@/lib/utils'

type Props = {
  /** 识别到的原始名 */
  originalName: string
  /** 用户备注 */
  remark?: string
  busy?: boolean
  onSave: (remark: string) => void | Promise<void>
  className?: string
}

/** 游戏标题：有备注优先展示；点铅笔直接改文字（无 input 框） */
export function GameTitleEditor({ originalName, remark = '', busy = false, onSave, className }: Props) {
  const stored = remark.trim()
  const display = stored || originalName
  const [editing, setEditing] = useState(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const skipCommitRef = useRef(false)

  useEffect(() => {
    if (!editing) return
    const node = titleRef.current
    if (!node) return
    node.textContent = stored || originalName
    node.focus()
    const range = document.createRange()
    range.selectNodeContents(node)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editing, stored, originalName])

  async function commit() {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    const raw = (titleRef.current?.textContent || '').trim().replace(/\s+/g, ' ')
    // 与原始名相同视为未设备注
    const next = raw === originalName.trim() ? '' : raw
    setEditing(false)
    if (next === stored) return
    await onSave(next)
  }

  function startEdit() {
    if (busy) return
    setEditing(true)
  }

  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-1.5', className)}>
      <span
        ref={titleRef}
        role={editing ? 'textbox' : undefined}
        aria-label="游戏备注名称"
        aria-readonly={!editing}
        contentEditable={editing && !busy}
        suppressContentEditableWarning
        tabIndex={editing ? 0 : undefined}
        className={cn(
          'min-w-0 max-w-full font-display text-lg font-semibold leading-[1.25] tracking-[-0.02em] text-ink',
          // 非编辑也占住下划线高度，避免切入编辑时抖动
          'border-b border-transparent pb-px',
          editing
            ? cn(
                'min-w-[10rem] cursor-text whitespace-nowrap outline-none border-accent',
                'empty:before:pointer-events-none empty:before:font-normal empty:before:text-ink-soft empty:before:content-[attr(data-placeholder)]'
              )
            : 'truncate'
        )}
        data-placeholder={originalName || '输入备注名称'}
        onBlur={() => {
          if (editing) void commit()
        }}
        onKeyDown={(e) => {
          if (!editing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            skipCommitRef.current = true
            if (titleRef.current) titleRef.current.textContent = display
            setEditing(false)
          }
        }}
      >
        {editing ? null : display}
      </span>
      {!editing ? (
        <button
          type="button"
          className={cn(
            'm-0 inline-flex size-[1.375rem] shrink-0 cursor-pointer appearance-none items-center justify-center border-none bg-transparent p-0 text-ink-soft opacity-45',
            'hover:opacity-100 hover:text-ink focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]',
            'disabled:cursor-not-allowed disabled:opacity-45'
          )}
          disabled={busy}
          aria-label="编辑备注名称"
          title="编辑备注名称"
          onClick={startEdit}
        >
          <GrFormEdit className="size-3.5" aria-hidden />
        </button>
      ) : (
        <span className="inline-flex size-[1.375rem] shrink-0" aria-hidden />
      )}
      {!editing && stored ? (
        <span className="min-w-0 truncate text-[0.75rem] font-normal text-ink-soft" title={originalName}>
          {originalName}
        </span>
      ) : null}
    </div>
  )
}
