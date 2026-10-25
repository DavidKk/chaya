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
  container.tabIndex = -1
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' })
  const stop = (e: Event) => e.stopPropagation()
  container.addEventListener('keydown', stop)
  container.addEventListener('keyup', stop)
  container.addEventListener('keypress', stop)
  shadow.addEventListener('keydown', stop)
  shadow.addEventListener('keyup', stop)
  shadow.addEventListener('keypress', stop)
  let mount = shadow.querySelector('.mount-root') as HTMLElement | null
  if (mount) return
  const style = document.createElement('style')
  style.textContent = overlayCss
  mount = document.createElement('div')
  mount.className = 'mount-root'
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
