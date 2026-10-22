/**
 * Custom Element + Shadow DOM mount (aligned with MagickMonkey mountUiTemplateShell)
 */
import { applyShadowStyles } from './adopted-styles'

const TEMPLATE_STYLE = Symbol('chayaTemplateStyle')

type TemplateWithStyle = HTMLTemplateElement & { [TEMPLATE_STYLE]?: string }

export function mountUiTemplateShell(container: HTMLElement, styleContent: string, htmlContent: string): void {
  const template = document.createElement('template')
  ;(template as TemplateWithStyle)[TEMPLATE_STYLE] = styleContent
  template.innerHTML = htmlContent
  container.appendChild(template)
}

export function adoptTemplateContent(target: Element | ShadowRoot, template: HTMLTemplateElement): void {
  while (target.firstChild) target.removeChild(target.firstChild)
  while (template.content.firstChild) {
    target.appendChild(template.content.firstChild)
  }
  const styleContent = (template as TemplateWithStyle)[TEMPLATE_STYLE]
  if (styleContent && target instanceof ShadowRoot) {
    target.adoptedStyleSheets = []
    applyShadowStyles(target, styleContent)
  }
}

/** Define CE once; return existing host or create & append to documentElement. */
export function ensureCustomElementHost(tag: string, Ctor: CustomElementConstructor): HTMLElement {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, Ctor)
  }
  let el = document.querySelector(tag) as HTMLElement | null
  if (!el) {
    el = document.createElement(tag)
    ;(document.documentElement || document.body).appendChild(el)
  }
  return el
}
