/** 顶栏下拉菜单（base-ui Menu）共用样式：语言切换、dev 服务形态切换 */
export const dropdownTriggerClass = [
  'inline-flex h-8 cursor-pointer items-center gap-1 rounded-[0.2rem] border border-transparent bg-transparent px-2 text-[0.8125rem] font-medium text-ink-soft transition-colors duration-100',
  'hover:bg-[rgb(230_238_248/0.06)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  'data-[popup-open]:bg-[rgb(230_238_248/0.06)] data-[popup-open]:text-ink',
].join(' ')

export const dropdownPopupClass =
  'min-w-[10rem] rounded-md border border-[rgb(230_238_248/0.1)] bg-[color-mix(in_oklab,var(--panel-2)_86%,white_6%)] p-1 shadow-[0_10px_28px_rgb(0_0_0/0.3)] outline-none backdrop-blur-md'

export const dropdownItemClass =
  'flex cursor-pointer items-center justify-between gap-3 rounded-[0.25rem] px-3 py-2 text-[0.8125rem] whitespace-nowrap text-ink outline-none data-[checked]:text-accent data-[highlighted]:bg-[rgb(230_238_248/0.07)]'
