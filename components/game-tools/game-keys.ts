import type { KeyboardEvent, MouseEvent } from 'react'

/** 浮层里的方向键、回车、空格不能再传给游戏，否则角色会跟着移动或确认 */
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '])

export function stopGameKeys(event: KeyboardEvent<HTMLElement>) {
  if (GAME_KEYS.has(event.key)) event.stopPropagation()
}

/** 鼠标按下不转移焦点：点完按钮、拖完把手后按键仍交给游戏；键盘用户照常 Tab 进入 */
export function keepGameFocus(event: MouseEvent<HTMLElement>) {
  event.preventDefault()
}
