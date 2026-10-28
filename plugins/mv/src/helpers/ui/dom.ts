/**
 * Trusted-Types-friendly HTML helpers (trimmed from MagickMonkey safe-inner-html)
 */

/** 清空子节点；不用 replaceChildren（旧 NW.js / Chromium 无此 API） */
export function clearElement(element: Element | ShadowRoot): void {
  while (element.firstChild) element.removeChild(element.firstChild)
}

function parseHtmlFragment(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  const fragment = document.createDocumentFragment()
  while (template.content.firstChild) {
    fragment.appendChild(template.content.firstChild)
  }
  return fragment
}

/** Assign HTML without relying on TrustedHTML policy (NW.js game context). */
export function setInnerHTML(element: Element | ShadowRoot, html: string): void {
  clearElement(element)
  const fragment = parseHtmlFragment(html)
  while (fragment.firstChild) {
    element.appendChild(fragment.firstChild)
  }
}

/**
 * 将焦点安全交还给游戏画布或 document.body，并确保不残留浏览器默认 focus outline。
 */
export function restoreGameFocus(): void {
  try {
    const graphics = (window as Window & { Graphics?: { _canvas?: HTMLElement } }).Graphics
    const el = graphics?._canvas ?? document.querySelector<HTMLElement>('canvas')
    if (el) {
      if (typeof el.getAttribute === 'function' && !el.hasAttribute('tabindex')) {
        el.tabIndex = -1
      }
      el.style.outline = 'none'
      if (typeof el.focus === 'function') {
        el.focus()
        return
      }
    }
    if (document.body) {
      if (typeof document.body.getAttribute === 'function' && !document.body.hasAttribute('tabindex')) {
        document.body.tabIndex = -1
      }
      document.body.style.outline = 'none'
      document.body.focus?.()
    }
    window.focus?.()
  } catch {
    /* */
  }
}
