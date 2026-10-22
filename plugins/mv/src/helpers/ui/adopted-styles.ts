/**
 * Constructable stylesheets into Document / ShadowRoot (from MagickMonkey shared/adopted-page-styles)
 */

function supportsConstructableStyleSheets(target: Document | ShadowRoot): boolean {
  try {
    return typeof CSSStyleSheet !== 'undefined' && typeof CSSStyleSheet.prototype.replaceSync === 'function' && 'adoptedStyleSheets' in target
  } catch {
    return false
  }
}

/** Append CSS text; prefer adoptedStyleSheets, fallback `<style>`. */
export function appendAdoptedStyles(target: Document | ShadowRoot, cssText: string): boolean {
  if (supportsConstructableStyleSheets(target)) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(cssText)
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet]
      return true
    } catch {
      /* fall through */
    }
  }

  const ownerDocument = target instanceof Document ? target : target.ownerDocument
  const style = (ownerDocument ?? document).createElement('style')
  style.textContent = cssText
  if (target instanceof Document) {
    target.head.appendChild(style)
  } else {
    target.prepend(style)
  }
  return false
}

export function applyShadowStyles(shadowRoot: ShadowRoot, cssText: string): void {
  appendAdoptedStyles(shadowRoot, cssText)
}
