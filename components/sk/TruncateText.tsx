'use client'

import { type HTMLAttributes, type ReactNode, useState } from 'react'

import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export type TruncateTextProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'title'> & {
  text: ReactNode
  /** 悬停提示内容；默认取渲染出的文字 */
  tip?: string
}

/** 单行省略；仅在文字确实被截断时 hover 显示完整内容 */
export function TruncateText({ text, tip, className, onMouseEnter, onFocus, ...rest }: TruncateTextProps) {
  const [content, setContent] = useState('')
  const measure = (el: HTMLElement) => setContent(el.scrollWidth > el.clientWidth + 1 ? (tip ?? el.textContent ?? '') : '')
  return (
    <Tooltip content={content} touchBehavior="passthrough">
      <span
        {...rest}
        className={cn('min-w-0 truncate', className)}
        onMouseEnter={(event) => {
          measure(event.currentTarget)
          onMouseEnter?.(event)
        }}
        onFocus={(event) => {
          measure(event.currentTarget)
          onFocus?.(event)
        }}
      >
        {text}
      </span>
    </Tooltip>
  )
}
