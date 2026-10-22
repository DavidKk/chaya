import { Activity } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { CompanionPanel } from '@/components/game-agent/CompanionPanel'
import { GameAgentSidebar } from '@/components/game-agent/GameAgentSidebar'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import type { CompanionState } from '@/lib/game-agent/companion'

import { readAgentGameState } from '../agent/handlers'
import { gameRoomId } from '../helpers'
import { ensureGameAgentHost } from './host'
import overlayCss from './overlay.css?inline'
import { pluginGameAgentRequest } from './request'

let root: Root | null = null
let host: HTMLElement | null = null
let open = false
let hasOpened = false
const observe = () => readAgentGameState() as CompanionState

function render() {
  if (!root) return
  root.render(
    <LocaleProvider syncDocumentLang={false}>
      <CompanionPanel gameId={gameRoomId()} open={open} observe={observe} request={pluginGameAgentRequest} />
      {hasOpened ? (
        <Activity mode={open ? 'visible' : 'hidden'}>
          <div className="pointer-events-auto absolute inset-y-0 right-0">
            <GameAgentSidebar gameId={gameRoomId()} onClose={hideGameAgentUi} request={pluginGameAgentRequest} open />
          </div>
        </Activity>
      ) : null}
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
  hasOpened = true
  host?.setAttribute('data-open', '')
  render()
}

export function mountGameAgentCompanion() {
  ensureMounted()
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
  hasOpened = false
}

export function isGameAgentUiOpen() {
  return open
}
