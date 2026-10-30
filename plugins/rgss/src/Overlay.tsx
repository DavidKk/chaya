import { useEffect, useMemo, useState } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { MiniPanelDock } from '@/components/game-tools/MiniPanelDock'
import { GameToolTransportContext } from '@/components/game-tools/transport'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { TranslationRuntimeProvider } from '@/components/translate/TranslationRuntimeContext'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createTranslationRpc, type TranslationPacket } from '@/lib/runtime/translation-rpc'
import { FloatingGameSaves } from '@/plugins/shared/FloatingGameSaves'

import { setupHitTestManager } from './hit-test-manager'
import { initHostBridge, onGameMessage, postToGame } from './host-bridge'
import { RgssMiniMap } from './MiniMap'
import { SubtitleOverlay } from './SubtitleOverlay'
import { requestToolSettings } from './tool-settings'
import { createRgssServiceTranslationRequest, createRgssTimingReporter, installRgssOverlayTranslationRuntime, readRgssOverlayConfig } from './translation-request'
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
  const overlayConfig = useMemo(() => readRgssOverlayConfig(), [])
  const translationRequest = useMemo(() => createRgssServiceTranslationRequest(overlayConfig), [overlayConfig])
  const roomId = parseQueryParam('roomId', '')
  const transport = useMemo(() => ({ roomId, connected: true, negotiating: false, localGlobal: true, send: postToGame, subscribeMessages: onGameMessage }), [roomId])
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)

  useEffect(() => installRgssOverlayTranslationRuntime(overlayConfig), [overlayConfig])

  useEffect(() => {
    const host = document.getElementById('chaya-rgss-overlay-container')
    if (host) {
      if (open) {
        host.setAttribute('data-open', '')
      } else {
        host.removeAttribute('data-open')
        const shadowAe = host.shadowRoot?.activeElement as HTMLElement | null
        if (shadowAe && typeof shadowAe.blur === 'function') {
          try {
            shadowAe.blur()
          } catch {
            /* */
          }
        }
        const ae = document.activeElement
        if (ae && (ae === host || host.contains(ae)) && typeof (ae as HTMLElement).blur === 'function') {
          try {
            ;(ae as HTMLElement).blur()
          } catch {
            /* */
          }
        }
      }
    }
    const nativeHost = window as Window & {
      webkit?: { messageHandlers?: { chaya?: { postMessage: (json: string) => void } } }
      chrome?: { webview?: { postMessage: (json: string) => void } }
    }
    const channel = nativeHost.webkit?.messageHandlers?.chaya ?? nativeHost.chrome?.webview
    if (channel) {
      channel.postMessage(JSON.stringify({ type: 'host.overlay', open }))
      try {
        postToGame({ type: 'overlay.open', open })
      } catch {
        /* ignore in environments without game bridge */
      }
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
      const isField = (node: unknown): node is HTMLElement =>
        node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable)

      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      let focusedInput: HTMLElement | null = null
      for (const node of path) {
        if (isField(node)) {
          focusedInput = node
          break
        }
      }
      if (!focusedInput) {
        const ae = document.activeElement
        if (isField(ae)) focusedInput = ae
        else if (ae instanceof HTMLElement && ae.shadowRoot?.activeElement && isField(ae.shadowRoot.activeElement)) {
          focusedInput = ae.shadowRoot.activeElement
        } else {
          const host = document.getElementById('chaya-rgss-overlay-container')
          const shadowAe = host?.shadowRoot?.activeElement
          if (isField(shadowAe)) focusedInput = shadowAe
        }
      }

      if (event.key === 'Escape') {
        if (open && focusedInput) {
          if (typeof focusedInput.blur === 'function') {
            focusedInput.blur()
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        return
      }

      if (event.code === 'Backquote' || event.key === '`') {
        if (event.ctrlKey || event.metaKey || event.altKey) return
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
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('chaya:toggle', toggle)
    document.addEventListener('chaya:esc', onEsc)
    return () => {
      document.removeEventListener('chaya:toggle', toggle)
      document.removeEventListener('chaya:esc', onEsc)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

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
    const roomId = overlayConfig.roomId || parseQueryParam('roomId', '')
    const apiBase = overlayConfig.apiBase || parseQueryParam('apiBase', window.location.origin)
    const translation = createTranslationRpc(
      (packet: TranslationPacket) => {
        gatewayInstance?.send(packet)
      },
      createRgssServiceTranslationRequest(overlayConfig),
      createRgssTimingReporter(overlayConfig)
    )
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
          if (msg.type === 'translation.rpc') {
            translation.receive(msg)
            return
          }
          postToGame(msg)
        },
      },
      { linkToken: overlayConfig.linkToken, launchToken: overlayConfig.launchToken }
    )
    gatewayInstance = gateway
    gateway.start()

    return () => {
      disposeBridge()
      hitTestDispose()
      unsub()
      translation.dispose()
      gateway.stop()
      gatewayInstance = null
    }
  }, [overlayConfig])

  return (
    <LocaleProvider syncDocumentLang={false}>
      <TranslationRuntimeProvider request={translationRequest}>
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
                <SubtitleOverlay />
                <RgssMiniMap tools={tools} />
                {tools.settings.panelDockEnabled && <MiniPanelDock settings={tools.settings} update={tools.update} />}
                {(tools.settings.quickSavePanelEnabled || tools.settings.autoSavePanelEnabled) && <FloatingGameSaves settings={tools.settings} tools={tools} />}
              </ConfirmProvider>
            </NotificationProvider>
          </div>
        </GameToolTransportContext.Provider>
      </TranslationRuntimeProvider>
    </LocaleProvider>
  )
}
