/** Publish geometry before the native view receives pointer input: hover-only detection
 * cannot re-enable an already transparent native view. Include Shadow DOM portals. */
type Rect = { x: number; y: number; width: number; height: number }
export function interactiveRects(root: Document | ShadowRoot): Rect[] {
  const rects: Rect[] = []
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (element.shadowRoot) rects.push(...interactiveRects(element.shadowRoot))
    if (!element.matches('.pointer-events-auto, [data-rgss-interactive], [role="dialog"], [role="tooltip"], [role="menu"], [role="listbox"], [data-portal]')) continue
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }
  return rects.slice(0, 256)
}

export function setupHitTestManager(): () => void {
  let last = ''
  const publish = () => {
    const rects = interactiveRects(document)
    const json = JSON.stringify({ type: 'host.regions', rects })
    if (json === last) return
    const host = window as Window & {
      webkit?: { messageHandlers?: { chaya?: { postMessage: (json: string) => void } } }
      chrome?: { webview?: { postMessage: (json: string) => void } }
    }
    const channel = host.webkit?.messageHandlers?.chaya ?? host.chrome?.webview
    if (!channel) return
    channel.postMessage(json)
    last = json
  }
  publish()
  const timer = window.setInterval(publish, 50)
  return () => window.clearInterval(timer)
}
