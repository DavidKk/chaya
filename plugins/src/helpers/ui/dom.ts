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
