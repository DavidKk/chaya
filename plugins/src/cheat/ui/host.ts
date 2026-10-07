/**
 * In-game GameEdit host: plain div + Shadow (style isolation); no customElements.
 */
import { applyShadowStyles, isolateEditableKeys } from '../../helpers'

export const GAME_EDIT_HOST_ID = 'chaya-game-edit-host'
export const GAME_EDIT_MOUNT_ID = 'chaya-game-edit-root'

export type GameEditHost = {
  host: HTMLElement
  /** React createRoot mount point (inside shadow) */
  mount: HTMLElement
  shadow: ShadowRoot
  setOpen: (open: boolean) => void
  isOpen: () => boolean
  containsFocus: (node: Node | null) => boolean
  remove: () => void
}

export function ensureGameEditHost(cssText: string): GameEditHost {
  // After HMR, tear down a leftover host entirely before remount (stale stylesheets / dirty DOM)
  const existing = document.getElementById(GAME_EDIT_HOST_ID)
  if (existing?.shadowRoot?.getElementById(GAME_EDIT_MOUNT_ID) && !existing.isConnected) {
    try {
      existing.remove()
    } catch {
      /* */
    }
  }

  let host = document.getElementById(GAME_EDIT_HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = GAME_EDIT_HOST_ID
    ;(document.documentElement || document.body).appendChild(host)
  }

  let shadow = host.shadowRoot
  if (!shadow) {
    shadow = host.attachShadow({ mode: 'open' })
    applyShadowStyles(shadow, cssText)
  }
  isolateEditableKeys(shadow)

  let mount = shadow.getElementById(GAME_EDIT_MOUNT_ID) as HTMLElement | null
  if (!mount) {
    mount = document.createElement('div')
    mount.id = GAME_EDIT_MOUNT_ID
    mount.className = 'mount-root'
    shadow.appendChild(mount)
  }

  return {
    host,
    mount,
    shadow,
    setOpen(open: boolean) {
      if (open) host!.setAttribute('data-open', '')
      else host!.removeAttribute('data-open')
    },
    isOpen() {
      return host!.hasAttribute('data-open')
    },
    containsFocus(node: Node | null) {
      if (!node || !shadow) return false
      return shadow.contains(node)
    },
    remove() {
      try {
        host!.remove()
      } catch {
        host!.parentNode?.removeChild(host!)
      }
    },
  }
}
