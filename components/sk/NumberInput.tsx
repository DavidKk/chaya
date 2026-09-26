'use client'

import { forwardRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { FORM_CONTROL_H, formControlChrome, formControlPadX } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'onChange' | 'value'> & {
  value: number
  onValueChange: (value: number) => void
  invalid?: boolean
  /** 允许小数；默认仅整数 */
  allowDecimal?: boolean
  min?: number
  max?: number
  /** 控件内后缀单位（如 倍），与输入同框 */
  suffix?: ReactNode
  /** 同框右侧操作（如锁死按钮）；与输入同框，不拆成第二个控件 */
  endAction?: ReactNode
  /**
   * 悬停提示；默认在「紧凑展示 ≠ 精确值」时自动显示精确数字。
   * 传空字符串可关闭自动 tip。
   */
  tooltip?: string
}

/** 编辑 / tip 用的完整数字串 */
export function formatExactNumber(n: number, allowDecimal = false): string {
  if (!Number.isFinite(n)) return '0'
  if (allowDecimal) return String(n)
  return String(Math.trunc(n))
}

/**
 * 未聚焦紧凑展示：位数过多时用科学计数（如 1.2e10），保留数量级；
 * 比单纯省略号更易扫读。聚焦时仍用 {@link formatExactNumber} 精确编辑。
 */
export function formatCompactNumber(n: number, allowDecimal = false, maxDigits = 8): string {
  if (!Number.isFinite(n)) return '0'
  const exact = formatExactNumber(n, allowDecimal)
  const digitLen = exact.replace(/^-/, '').replace('.', '').length
  if (digitLen <= maxDigits) return exact

  const exp = n.toExponential(allowDecimal ? 3 : 2)
  return exp
    .replace(/e\+/, 'e')
    .replace(/(\.\d*?)0+e/, '$1e')
    .replace(/\.e/, 'e')
}

function sanitize(raw: string, allowDecimal: boolean) {
  // 允许科学计数输入：1e10、1.5E+9
  let next = raw.replace(allowDecimal ? /[^\d.eE+-]/g : /[^\d.eE+-]/g, '')
  if (!allowDecimal) {
    // 整数模式下仍可有一个小数点（科学计数系数）
    const eIdx = next.search(/[eE]/)
    const head = eIdx === -1 ? next : next.slice(0, eIdx)
    const tail = eIdx === -1 ? '' : next.slice(eIdx)
    const dot = head.indexOf('.')
    if (dot !== -1) {
      next = `${head.slice(0, dot + 1)}${head.slice(dot + 1).replace(/\./g, '')}${tail}`
    } else {
      next = head + tail
    }
  } else {
    const dot = next.indexOf('.')
    if (dot !== -1) {
      next = `${next.slice(0, dot + 1)}${next.slice(dot + 1).replace(/\./g, '')}`
    }
  }
  return next
}

function parseValue(raw: string, allowDecimal: boolean) {
  if (!raw || raw === '.' || raw === '-' || raw === '+' || /^[eE]/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return allowDecimal ? n : Math.trunc(n)
}

function clamp(n: number, min?: number, max?: number) {
  let next = n
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { className, invalid = false, value, onValueChange, disabled, allowDecimal = false, min, max, suffix, endAction, tooltip, onBlur, onFocus, ...rest },
  ref
) {
  const exact = formatExactNumber(value, allowDecimal)
  const compact = formatCompactNumber(value, allowDecimal)
  const [text, setText] = useState(() => compact)
  const [focused, setFocused] = useState(false)
  const textRef = useRef(text)
  const affix = suffix != null || endAction != null
  const inputLocked = !!disabled && endAction != null

  useEffect(() => {
    if (!focused) setText(formatCompactNumber(value, allowDecimal))
  }, [value, focused, allowDecimal])

  function commit(raw: string) {
    const parsed = parseValue(raw, allowDecimal)
    if (parsed === null) {
      const fallback = Number.isFinite(value) ? value : typeof min === 'number' ? min : 0
      const normalized = clamp(fallback, min, max)
      setText(formatExactNumber(normalized, allowDecimal))
      if (normalized !== value) onValueChange(normalized)
      return
    }
    const next = clamp(parsed, min, max)
    // Number("0100") → 100；统一写成规范串，避免前导零残留
    setText(formatExactNumber(next, allowDecimal))
    if (next !== value) onValueChange(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(sanitize(e.currentTarget.value, allowDecimal))
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setText(formatExactNumber(value, allowDecimal))
      textRef.current = formatExactNumber(value, allowDecimal)
      e.currentTarget.blur()
      return
    }
    rest.onKeyDown?.(e)
  }

  const display = focused ? text : compact
  const autoTip = !focused && compact !== exact ? exact : undefined
  const tip = tooltip === '' ? undefined : (tooltip ?? autoTip)

  const input = (
    <input
      ref={ref}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={display}
      title={!tip ? exact : undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        'font-mono',
        affix
          ? 'm-0 h-full min-h-0 min-w-[3.5rem] flex-1 appearance-none rounded-none border-none bg-transparent px-[0.1rem] py-0 font-inherit text-[0.8125rem] leading-none text-ink outline-none disabled:cursor-not-allowed'
          : cn(formControlChrome, formControlPadX, FORM_CONTROL_H, 'min-w-[5.5rem] focus:border-accent disabled:cursor-not-allowed disabled:opacity-45'),
        inputLocked && 'cursor-not-allowed opacity-55',
        !affix && invalid && 'border-fail',
        !affix && className
      )}
      {...rest}
      onFocus={(e) => {
        setFocused(true)
        const next = formatExactNumber(value, allowDecimal)
        textRef.current = next
        setText(next)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        // 用 DOM 当前值，避免 onChange 后立刻 blur 时闭包里的 text 过期
        commit(sanitize(e.currentTarget.value, allowDecimal))
        onBlur?.(e)
      }}
      onChange={(e) => {
        // 输入过程只改本地串，不立刻 onValueChange，避免父级重渲染抢走光标 / 无法删改
        const next = sanitize(e.target.value, allowDecimal)
        textRef.current = next
        setText(next)
      }}
      onKeyDown={onKeyDown}
    />
  )

  /* 有 endAction 时 tip 只包输入，避免盖住右侧 +1 / 锁死 等各自的 tooltip */
  const tippedInput =
    tip && affix ? (
      <Tooltip content={tip} triggerClassName="inline-flex h-full min-w-0 flex-1">
        {input}
      </Tooltip>
    ) : (
      input
    )

  const shellDisabled = !!disabled && endAction == null

  const control = !affix ? (
    input
  ) : (
    <span
      className={cn(
        formControlChrome,
        FORM_CONTROL_H,
        'inline-flex w-fit min-w-[5.5rem] items-center gap-[0.2rem] pr-[0.4rem] pl-[0.45rem] focus-within:border-accent',
        'group/num',
        invalid && 'border-fail',
        shellDisabled && 'cursor-not-allowed opacity-45',
        className
      )}
      data-disabled={shellDisabled || undefined}
    >
      {tippedInput}
      {suffix != null ? (
        <span className={cn('inline-flex h-[1.35rem] min-w-[1.35rem] shrink-0 items-center justify-center', 'select-none text-[0.7rem] font-medium leading-none text-ink-soft')}>
          {suffix}
        </span>
      ) : null}
      {endAction != null ? <span className="ms-[0.1rem] inline-flex shrink-0 items-center">{endAction}</span> : null}
    </span>
  )

  if (!tip || affix) return control

  return (
    <Tooltip content={tip} triggerClassName={className?.includes('w-') ? 'inline-flex max-w-full' : undefined}>
      {disabled ? <span className="inline-flex max-w-full">{control}</span> : control}
    </Tooltip>
  )
})
