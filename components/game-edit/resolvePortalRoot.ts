/** 局内面板运行在 ShadowRoot，弹层必须挂在同一根节点才能继承样式。 */
export function resolvePortalRoot(trigger: Element | null): HTMLElement {
  if (!trigger) return document.body
  const root = trigger.getRootNode()
  if (!(root instanceof ShadowRoot)) return document.body
  const attribute = 'data-chaya-menu-root'
  const existing = root.querySelector<HTMLElement>(`[${attribute}]`)
  if (existing) return existing
  const portal = document.createElement('div')
  portal.setAttribute(attribute, '')
  root.appendChild(portal)
  return portal
}
