import { useEffect, useMemo, useState } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { MiniPanelDock } from '@/components/game-tools/MiniPanelDock'
import { GameToolTransportContext } from '@/components/game-tools/transport'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { FloatingGameSaves } from '@/plugins/shared/FloatingGameSaves'

import { setupHitTestManager } from './hit-test-manager'
import { initHostBridge, onGameMessage, postToGame } from './host-bridge'
import { RgssMiniMap } from './MiniMap'
import { requestToolSettings } from './tool-settings'
import { RgssWebRtcGateway } from './webrtc-gateway'
import { RgssWorkbench } from './Workbench'

function parseQueryParam(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  try {
    const config = (window as Window & { __CHAYA_RGSS_CONFIG__?: Record<string, string> }).__CHAYA_RGSS_CONFIG__
    if (config?.[key]) return config[key]
    const params = new URLSearchParams(window.location.search)
    return params.get(key) || fallback
  } catch {
    return fallback
  }
}

export function RgssOverlayRoot() {
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const [_session, setSession] = useState<any>(null)
  const [_gatewayConnected, setGatewayConnected] = useState(false)
  const tools = useToolSettings(requestToolSettings)
  const roomId = parseQueryParam('roomId', '')
  const transport = useMemo(() => ({ roomId, connected: true, negotiating: false, localGlobal: true, send: postToGame, subscribeMessages: onGameMessage }), [roomId])
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = document.getElementById('chaya-rgss-overlay-container')
    if (host) {
      if (open) host.setAttribute('data-open', '')
      else host.removeAttribute('data-open')
    }
  }, [open])

  useEffect(() => {
    const toggle = () => {
      setOpen((value) => {
        const next = !value
        if (next) setHasOpened(true)
        return next
      })
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.code === 'Backquote' || event.key === '`') {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        const target = event.composedPath()[0]
        if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setOpen((value) => {
          const next = !value
          if (next) setHasOpened(true)
          return next
        })
      }
    }
    const onEsc = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('chaya:toggle', toggle)
    document.addEventListener('chaya:esc', onEsc)
    return () => {
      document.removeEventListener('chaya:toggle', toggle)
      document.removeEventListener('chaya:esc', onEsc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    // 1. Initialize native host postMessage bridge
    const disposeBridge = initHostBridge()
    const hitTestDispose = setupHitTestManager()

    // 2. Listen to state updates from Ruby
    let gatewayInstance: RgssWebRtcGateway | null = null
    const unsub = onGameMessage((msg) => {
      if (msg.type === 'edit.state') {
        setSession(msg.session)
      }
      // Forward game replies to WebRTC client if connected
      if (gatewayInstance) {
        gatewayInstance.send(msg)
      }
    })

    // 3. Connect embedded WebRTC gateway to external console
    const roomId = parseQueryParam('roomId', '')
    const apiBase = parseQueryParam('apiBase', window.location.origin)
    const gateway = new RgssWebRtcGateway(
      roomId,
      apiBase,
      {
        onConnected: () => {
          setGatewayConnected(true)
          postToGame({ type: 'edit.subscribe' })
        },
        onDisconnected: () => setGatewayConnected(false),
        onMessage: (msg: GameLinkMessage) => {
          // Forward WebRTC commands into Ruby host
          postToGame(msg)
        },
      },
      { linkToken: parseQueryParam('linkToken'), launchToken: parseQueryParam('launchToken') }
    )
    gatewayInstance = gateway
    gateway.start()

    return () => {
      disposeBridge()
      hitTestDispose()
      unsub()
      gateway.stop()
      gatewayInstance = null
    }
  }, [])

  return (
    <LocaleProvider syncDocumentLang={false}>
      <GameToolTransportContext.Provider value={transport}>
        <div
          ref={setPortalHost}
          data-mini-panel-root=""
          className="relative flex min-h-0 flex-1 flex-col"
          style={{ '--mini-panel-opacity': String(tools.settings.miniPanelOpacity / 100) } as any}
        >
          <NotificationProvider portalContainer={portalHost}>
            <ConfirmProvider portalContainer={portalHost}>
              {hasOpened && (
                <div style={{ display: open ? 'flex' : 'none' }} className="min-h-0 flex-1 flex-col">
                  <RgssWorkbench open={open} onClose={() => setOpen(false)} />
                </div>
              )}
              <RgssMiniMap tools={tools} />
              {tools.settings.panelDockEnabled && <MiniPanelDock settings={tools.settings} update={tools.update} />}
              {(tools.settings.quickSavePanelEnabled || tools.settings.autoSavePanelEnabled) && <FloatingGameSaves settings={tools.settings} tools={tools} />}
            </ConfirmProvider>
          </NotificationProvider>
        </div>
      </GameToolTransportContext.Provider>
    </LocaleProvider>
  )
}
