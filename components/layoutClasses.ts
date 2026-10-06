import { cn } from '@/lib/utils'

/**
 * 间距真源。只用 4px 阶梯：1(4) / 2(8) / 3(12) / 4(16)，6+ 仅空态与营销大块；勿写 rem 魔法数或 .5 档。
 * 容器内边距 = 其子块间距 = 分隔线两侧留白（卡片 p-4 → gap-4、分隔 pt-4）。
 *
 * | Token | 值 | 用途 |
 * | --- | --- | --- |
 * | `padXDense` / `padYDense` | 3 / 2 | GameEdit 运行表单、角色表单、编辑表行 |
 * | `padXComfort` / `padYComfort` | 4 / 4 | 首页设置等宽松表单、卡片 |
 * | `gapField` | 1 | 标题↔描述↔控件竖向 |
 * | `gapControl` | 1 | 同行控件之间 |
 * | `gapInline` / `gapInlineDense` | 4 / 3 | 左右分栏标题列↔控件列 |
 */
export const padXDense = 'px-3'
export const padYDense = 'py-2'
export const padXComfort = 'px-4'
export const padYComfort = 'py-4'
export const gapField = 'gap-1'
export const gapControl = 'gap-1'
export const gapInline = 'gap-x-4'
export const gapInlineDense = 'gap-x-3'

/** 编辑表 / 数据表单元格：与 formCardDense 子项同边距 */
export const editCell = cn(padXDense, padYDense)
export const editHeadCell = cn(editCell, 'text-[0.68rem] font-semibold tracking-[0.05em] text-ink-soft uppercase')

/** 全页壳 */
export const pageShell = 'relative z-[1] flex h-dvh flex-col overflow-hidden'

/** 顶栏外框：只负责底线与背景；主导航指示条在此框上重合，勿加 overflow:hidden */
export const topBarFrame = 'relative shrink-0 border-b border-line bg-paper-2'
export const topBarRow = 'box-border flex h-[3.25rem] max-h-[3.25rem] min-h-[3.25rem] items-center gap-4 overflow-visible bg-transparent px-4'
/** 旧单层顶栏（无滑动底线导航时可用）；带 AppNav 请用 `AppTopBar` */
export const topBar = cn(topBarFrame, topBarRow)
/** 主导航槽：相对内容行向下多 1px，指示条与 frame 底线重合；勿放进 overflow:hidden */
export const topBarNav = 'relative z-[2] -mb-px flex h-[calc(3.25rem+1px)] shrink-0 self-end overflow-visible'

export const brand = 'm-0 inline-flex items-center font-display text-[1.05rem] font-semibold leading-none tracking-[-0.02em] text-ink'

export const topRight = 'ml-auto flex min-w-0 items-center gap-3'

/** 带内边距的主区；flush 用于 logs / cache / edit */
export const pageMain = 'flex min-h-0 flex-1 flex-col gap-4 p-4'
export const pageMainFlush = 'flex min-h-0 flex-1 flex-col p-0'

/** panel-shell：head / body / foot */
export const panelShell = 'flex min-h-0 flex-1 flex-col overflow-hidden border-none bg-transparent'
export const panelHead = 'flex h-[3.25rem] max-h-[3.25rem] min-h-[3.25rem] min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-hidden border-b border-line bg-transparent px-4'
export const panelHeadEnd = 'ml-auto inline-flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-2'
export const panelBody = 'flex min-h-0 flex-1 flex-col bg-paper-2'
export const panelFoot =
  'flex shrink-0 items-center justify-between gap-3 border-t border-line bg-transparent px-4 py-2 text-[0.7rem] text-ink-soft [&_span:first-child]:min-w-0 [&_span:first-child]:truncate'

/** 功能区底部的使用须知条（`LegalNotice`） */
export const legalBar = 'shrink-0 border-t border-line px-4 py-2'

/** 表单卡片（内缩浅线分隔；子项统一内边距，勿在子组件再叠 py） */
export const formCard = cn(
  'm-0 flex w-full max-w-none flex-col overflow-hidden rounded-[0.35rem] border border-line bg-panel',
  '[&>*]:box-border [&>*]:m-0 [&>*]:rounded-none [&>*]:border-none [&>*]:bg-transparent [&>*]:px-4 [&>*]:py-4',
  '[&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:inset-x-4 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-[var(--line-soft)]'
)

/** 运行 / 角色等基础页：与编辑表行同边距，尽量一屏看完 */
export const formCardDense = cn(formCard, '[&>*]:px-3 [&>*]:py-2 [&>*+*]:before:inset-x-3')

/** 设置子页的卡片列：靠左排列，按表单内容选宽度档位。 */
export const settingsCardColumn = 'flex w-full flex-col gap-4'
export const settingsCardNarrow = cn(settingsCardColumn, 'max-w-xl')
export const settingsCardWide = cn(settingsCardColumn, 'max-w-2xl')

export const formField = cn('flex flex-col items-stretch', gapField)
/** 左右分栏表单项：略宽松，避免数字行与开关行挤在一起 */
export const formFieldInline = cn('grid min-h-[3.1rem] grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] items-center gap-y-1', gapInline)
export const formFieldInlineDense = cn(formFieldInline, 'min-h-[2.35rem]', gapInlineDense)
export const formTitle = 'text-[0.8125rem] font-medium leading-[1.3] text-ink'
export const formTitleInline = cn(formTitle, 'col-start-1 row-start-1')
export const formDesc = 'text-[0.7rem] leading-[1.35] text-ink-soft'
export const formDescInline = cn(formDesc, 'col-start-1 row-start-2')
export const formControl = cn('mt-0.5 flex min-w-0 items-center', gapControl)
export const formControlInline = cn('col-start-2 row-span-2 row-start-1 mt-0 flex w-full items-center justify-end', gapControl)
export const formMonoInput = 'font-mono text-[0.72rem]'

/** 数据表（sticky 表头）；单元格边距对齐 formCardDense / editCell */
export const dataTable = cn(
  'w-full border-separate border-spacing-0 text-left text-[0.8125rem]',
  '[&_thead]:relative [&_thead]:z-[3]',
  '[&_th]:sticky [&_th]:top-0 [&_th]:z-[3] [&_th]:border-b [&_th]:border-line [&_th]:bg-paper-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-[0.68rem] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.05em] [&_th]:text-ink-soft',
  '[&_td]:relative [&_td]:z-0 [&_td]:max-w-[18rem] [&_td]:break-words [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle',
  '[&_tbody_tr:first-child_td]:border-t-0',
  '[&_tr:hover_td]:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
)

export const logBadgeBase =
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2 py-1 text-[0.72rem] font-semibold uppercase leading-none tracking-[0.02em]'

const logBadgeTone: Record<string, string> = {
  ok: 'border-[color-mix(in_oklab,var(--ok)_35%,transparent)] bg-[color-mix(in_oklab,var(--ok)_12%,transparent)] text-ok',
  warn: 'border-[color-mix(in_oklab,var(--warn)_40%,transparent)] bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] text-warn',
  fail: 'border-[color-mix(in_oklab,var(--fail)_40%,transparent)] bg-[color-mix(in_oklab,var(--fail)_12%,transparent)] text-fail',
  info: 'border-[color-mix(in_oklab,var(--info)_40%,transparent)] bg-[color-mix(in_oklab,var(--info)_12%,transparent)] text-info',
  debug: 'border-[color-mix(in_oklab,var(--debug)_40%,transparent)] bg-[color-mix(in_oklab,var(--debug)_12%,transparent)] text-debug',
}

export function logBadgeClass(level: string) {
  return cn(logBadgeBase, logBadgeTone[level] ?? logBadgeTone.info)
}
