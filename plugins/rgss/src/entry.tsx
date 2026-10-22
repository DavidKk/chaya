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
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = overlayCss
  const mount = document.createElement('div')
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
