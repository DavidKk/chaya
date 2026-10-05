import { applyShadowStyles } from '../helpers'

const HOST_ID = 'chaya-game-agent-host'
const MOUNT_ID = 'chaya-game-agent-root'

export function ensureGameAgentHost(cssText: string) {
  let host = document.getElementById(HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = HOST_ID
    ;(document.documentElement || document.body).appendChild(host)
  }
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
  applyShadowStyles(shadow, cssText)
  let mount = shadow.getElementById(MOUNT_ID) as HTMLElement | null
  if (!mount) {
    mount = document.createElement('div')
    mount.id = MOUNT_ID
    mount.className = 'agent-mount-root'
    shadow.appendChild(mount)
  }
  return { host, mount, shadow }
}
