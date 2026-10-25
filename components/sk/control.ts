import { cn } from '@/lib/utils'

/** 表单控件统一高度（Button md/icon、Input、Select、NumberInput） */
export const FORM_CONTROL_H = 'h-8'

/** 输入类控件外框：固定高度 + 描边 + paper 底 */
export const formControlChrome = cn(
  'box-border h-8 appearance-none rounded-[0.15rem] border border-line bg-paper font-inherit text-[0.8125rem] leading-none text-ink outline-none transition-[border-color] duration-100'
)

export const formControlPadX = 'px-2'

/** 全站统一禁用态（原生控件用 `disabled:` 变体） */
export const controlDisabled = 'disabled:cursor-not-allowed disabled:opacity-45'

/** 同上，给 span 外壳等非原生控件按条件追加 */
export const controlDisabledShell = 'cursor-not-allowed opacity-45'
