'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { INTEGRATION_TABS } from '@/components/integration/tabs'
import { TRANSLATE_TABS } from '@/components/translate/tabs'
import { createPageToolSync, registerPageTools } from '@/initializer/webmcp/register-page-tools'
import { usePageWebMcp } from '@/initializer/webmcp/usePageWebMcp'
import { edgeUnavailableTools } from '@/lib/webmcp/mode-matrix'
import { MCP_REGISTRAR_ID, PLUGINS_REGISTRAR_ID } from '@/lib/webmcp/registrars'

import { buildEdgeMcpTools, loadEdgePluginTools } from './edge'
import type { EdgeLinkDeps } from './edge/link'
import { buildMirrorTools, fetchMirrorTools } from './mcp-mirror-client'
import { buildPageTools, PAGE_REGISTRAR_ID, type PageRoute } from './page/tools'

export { MCP_REGISTRAR_ID, PLUGINS_REGISTRAR_ID } from '@/lib/webmcp/registrars'
/** Plugin tools follow the agent bridge (not this tab's DataChannel), so poll often; tools/list is local and cheap. */
const MIRROR_SYNC_MS = 10_000
/** The agent bridge / ChayaAgent usually report plugin tools a few seconds after the DataChannel opens. */
const PLUGIN_TOOL_RETRY_MS = [0, 3_000, 10_000, 30_000]

type HostMode = { kind: 'local' | 'edge'; serviceMode: string } | { kind: 'guest' }

const ROUTES: PageRoute[] = [
  { path: '/game', label: 'Game library' },
  { path: '/cheat/run', label: 'Cheat' },
  ...TRANSLATE_TABS.map((tab) => ({ path: `/translate/${tab.id}`, label: tab.id === 'cache' ? 'Shared translation library' : 'Translate' })),
  { path: '/logs', label: 'Logs' },
  ...INTEGRATION_TABS.map((tab) => ({ path: tab.href, label: `Integration · ${tab.id}` })),
]

/** Mode via /api/status (not the MCP connection endpoint, which only serves the integration page). 401 = signed-out public page. */
async function detectMode(): Promise<HostMode> {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) return { kind: 'guest' }
    const data = (await res.json()) as { canUseDisk?: boolean; serviceMode?: string }
    return data.canUseDisk === false ? { kind: 'edge', serviceMode: data.serviceMode || 'vercel' } : { kind: 'local', serviceMode: data.serviceMode || 'local' }
  } catch {
    return { kind: 'guest' }
  }
}

type LinkRef = { current: ReturnType<typeof useGameLinkContext> }

/** Edge link deps that always read the latest GameLink context. */
function edgeLinkDeps(ref: LinkRef): EdgeLinkDeps {
  return {
    connected: () => ref.current.connected,
    roomId: () => ref.current.roomId,
    callAgent: (method, params) => ref.current.callAgent(method, params),
    translationRequest: (request, signal) => ref.current.translationRequest(request, signal),
    requestCatalog: () => ref.current.requestCatalog(),
  }
}

function logFailure(registrar: string, error: unknown) {
  // eslint-disable-next-line no-console -- registration failures must be visible in development
  if (process.env.NODE_ENV === 'development') console.error(`[WebMCP] "${registrar}" registration failed`, error)
}

/** Mounted once in AppProviders: registers page, edit, MCP and plugin tools on every page. */
export function ChayaWebMcpHost() {
  const router = useRouter()
  const link = useGameLinkContext()
  const linkRef = useRef(link)
  linkRef.current = link
  const [supported, setSupported] = useState(false)
  const [mode, setMode] = useState<HostMode | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  usePageWebMcp(
    PAGE_REGISTRAR_ID,
    () =>
      buildPageTools({
        navigate: (path) => router.push(path),
        routes: () => ROUTES,
        context: () => {
          const current = modeRef.current
          const { roomId, connected } = linkRef.current
          return {
            serviceMode: current && current.kind !== 'guest' ? current.serviceMode : 'unauthorized',
            game: { roomId, connected },
            unavailableTools: current?.kind === 'edge' ? edgeUnavailableTools() : [],
          }
        },
      }),
    {
      onRegistered: () => {
        setSupported(true)
        return () => setSupported(false)
      },
    }
  )

  useEffect(() => {
    let cancelled = false
    void detectMode().then((next) => {
      if (!cancelled) setMode(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const authed = !!mode && mode.kind !== 'guest'
  const edge = mode?.kind === 'edge'
  const serviceMode = mode && mode.kind !== 'guest' ? mode.serviceMode : ''

  useEffect(() => {
    if (!authed) return
    const controller = new AbortController()
    const live = () => linkRef.current
    if (edge) {
      const edgeTools = buildEdgeMcpTools({
        ...edgeLinkDeps(linkRef),
        gameOnline: () => live().connected,
        quit: (reason) => live().quit(reason),
        serviceMode,
      })
      registerPageTools(MCP_REGISTRAR_ID, edgeTools, controller.signal).catch((error: unknown) => logFailure(MCP_REGISTRAR_ID, error))
    }
    return () => controller.abort()
  }, [authed, edge, serviceMode, supported])

  const connected = link.connected
  const mirrorRefreshRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!authed || edge) return
    const sync = createPageToolSync(MCP_REGISTRAR_ID)
    const controller = new AbortController()
    let latest = 0
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      const seq = ++latest
      fetchMirrorTools(controller.signal)
        .then((tools) => (seq === latest ? sync.sync(buildMirrorTools(tools)) : false))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) logFailure(MCP_REGISTRAR_ID, error)
        })
    }
    mirrorRefreshRef.current = refresh
    refresh()
    const timer = window.setInterval(refresh, MIRROR_SYNC_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      mirrorRefreshRef.current = null
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      sync.dispose()
    }
  }, [authed, edge, supported])

  useEffect(() => {
    if (!connected) {
      mirrorRefreshRef.current?.()
      return
    }
    const timers = PLUGIN_TOOL_RETRY_MS.slice(1).map((ms) => window.setTimeout(() => mirrorRefreshRef.current?.(), ms))
    mirrorRefreshRef.current?.()
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [connected])

  useEffect(() => {
    if (!authed || !edge) return
    const sync = createPageToolSync(PLUGINS_REGISTRAR_ID)
    let cancelled = false
    let timer = 0
    const attempt = (index: number) => {
      loadEdgePluginTools(edgeLinkDeps(linkRef))
        .then((tools) => {
          if (cancelled) return
          if (!tools.length && index + 1 < PLUGIN_TOOL_RETRY_MS.length) schedule(index + 1)
          return sync.sync(tools)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          if (index + 1 < PLUGIN_TOOL_RETRY_MS.length) schedule(index + 1)
          else logFailure(PLUGINS_REGISTRAR_ID, error)
        })
    }
    const schedule = (index: number) => {
      timer = window.setTimeout(() => attempt(index), PLUGIN_TOOL_RETRY_MS[index])
    }
    if (connected) schedule(0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      sync.dispose()
    }
  }, [authed, edge, connected, supported])

  return null
}
