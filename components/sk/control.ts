import { cn } from '@/lib/utils'

/** 表单控件统一高度（Button md/icon、Input、Select、NumberInput） */
export const FORM_CONTROL_H = 'h-8'

/** 输入类控件外框：固定高度 + 描边 + paper 底 */
export const formControlChrome = cn(
  'box-border h-8 appearance-none rounded-[0.15rem] border border-line bg-paper font-inherit text-[0.8125rem] leading-none text-ink outline-none transition-[border-color] duration-100'
)

export const formControlPadX = 'px-[0.55rem]'

/** 工具条筛选开关（仅有名 / NSFW 等）：未开描边弱字，开态底边短横（居中、不随文宽） */
export const filterToggle = cn(
  'relative inline-flex h-8 shrink-0 cursor-pointer items-center rounded-[0.2rem] border border-line bg-inset px-2.5 text-[0.75rem] text-ink-soft transition-colors',
  'hover:text-ink disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45'
)

const filterToggleBar = 'after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-3 after:-translate-x-1/2 after:rounded-full'

export const filterToggleOn = cn(
  'border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_12%,var(--panel))] text-accent',
  filterToggleBar,
  'after:bg-accent'
)

/** NSFW 等：开态用 warn（黄）描边与底边短横 */
export const filterToggleOnWarn = cn(
  'border-[color-mix(in_oklab,var(--warn)_55%,var(--line))] bg-[color-mix(in_oklab,var(--warn)_12%,var(--panel))] text-warn',
  filterToggleBar,
  'after:bg-warn'
)
