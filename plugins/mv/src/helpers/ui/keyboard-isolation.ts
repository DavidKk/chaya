const isolatedRoots = new WeakSet<ShadowRoot | HTMLElement>()

/**
 * 拦截宿主与浮层内的一切键盘事件，防止输入内容、回车、删除、快捷键等冒泡穿透到游戏引擎。
 */
export function isolateHostKeyboard(target: ShadowRoot | HTMLElement): () => void {
  if (isolatedRoots.has(target)) return () => {}
  isolatedRoots.add(target)

  const stopKeyboard = (event: Event) => {
    event.stopPropagation()
  }

  target.addEventListener('keydown', stopKeyboard)
  target.addEventListener('keyup', stopKeyboard)

  return () => {
    target.removeEventListener('keydown', stopKeyboard)
    target.removeEventListener('keyup', stopKeyboard)
    isolatedRoots.delete(target)
  }
}

/** 兼容旧接口：隔离宿主内一切键盘事件 */
export function isolateEditableKeys(shadow: ShadowRoot): void {
  isolateHostKeyboard(shadow)
}
