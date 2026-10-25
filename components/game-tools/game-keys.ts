import type { KeyboardEvent, MouseEvent } from 'react'

/**
 * 浮层与插件内的所有按键事件均不冒泡传给游戏，防止输入内容、回车、删除、快捷键等穿透到游戏引擎。
 */
export function stopGameKeys(event: KeyboardEvent<HTMLElement>) {
  event.stopPropagation()
}

/**
 * 兼容旧接口：点击浮层内部元素时正常聚焦，不再 preventDefault 强行保留游戏焦点。
 */
export function keepGameFocus(_event: MouseEvent<HTMLElement>) {
  // 不再 preventDefault：允许点击正常转移焦点到面板与按钮
}
