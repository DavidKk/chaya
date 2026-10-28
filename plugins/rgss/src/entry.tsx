import { createRoot } from 'react-dom/client'

import { RgssOverlayRoot } from './Overlay'
import overlayCss from './overlay.css?inline'

export function mountRgssOverlay() {
  if (typeof document === 'undefined') return
  let container = document.getElementById('chaya-rgss-overlay-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'chaya-rgss-overlay-container'
    document.body.appendChild(container)
  }
  container.removeAttribute('tabindex')
  container.style.setProperty('outline', 'none', 'important')
  let globalStyle = document.getElementById('chaya-rgss-global-style')
  if (!globalStyle && document.head) {
    globalStyle = document.createElement('style')
    globalStyle.id = 'chaya-rgss-global-style'
    globalStyle.textContent =
      '*:focus, *:focus-visible, #chaya-rgss-overlay-container, #chaya-rgss-overlay-container:focus, #chaya-rgss-overlay-container:focus-visible, body, html { outline: none !important; }'
    document.head.appendChild(globalStyle)
  }
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' })
  const stop = (e: Event) => e.stopPropagation()
  container.addEventListener('keydown', stop)
  container.addEventListener('keyup', stop)
  container.addEventListener('keypress', stop)
  shadow.addEventListener('keydown', stop)
  shadow.addEventListener('keyup', stop)
  shadow.addEventListener('keypress', stop)
  let mount = shadow.querySelector('.mount-root') as HTMLElement | null
  if (mount) {
    mount.style.setProperty('outline', 'none', 'important')
    return
  }
  const style = document.createElement('style')
  style.textContent = overlayCss
  mount = document.createElement('div')
  mount.className = 'mount-root'
  mount.style.setProperty('outline', 'none', 'important')
  shadow.append(style, mount)
  const root = createRoot(mount)
  root.render(<RgssOverlayRoot />)
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountRgssOverlay)
  } else {
    mountRgssOverlay()
  }
}
