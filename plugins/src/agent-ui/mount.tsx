import { createRoot, type Root } from 'react-dom/client'

import { GameAgentSidebar } from '@/components/game-agent/GameAgentSidebar'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

import { gameRoomId } from '../helpers'
import { ensureGameAgentHost } from './host'
import overlayCss from './overlay.css?inline'
import { pluginGameAgentRequest } from './request'

let root: Root | null = null
let host: HTMLElement | null = null
let open = false

function render() {
  if (!root) return
  root.render(
    <LocaleProvider syncDocumentLang={false}>
      <GameAgentSidebar gameId={gameRoomId()} open={open} onClose={hideGameAgentUi} request={pluginGameAgentRequest} />
    </LocaleProvider>
  )
}

function ensureMounted() {
  if (root && host) return
  const next = ensureGameAgentHost(overlayCss)
  host = next.host
  root = createRoot(next.mount)
}

export function showGameAgentUi() {
  ensureMounted()
  open = true
  host?.setAttribute('data-open', '')
  render()
}

export function hideGameAgentUi() {
  open = false
  host?.removeAttribute('data-open')
  render()
  if (typeof Input !== 'undefined' && Input.clear) Input.clear()
  document.body?.focus?.()
}

export function toggleGameAgentUi() {
  if (open) hideGameAgentUi()
  else showGameAgentUi()
}

export function unmountGameAgentUi() {
  root?.unmount()
  root = null
  host?.remove()
  host = null
  open = false
}

export function isGameAgentUiOpen() {
  return open
}
