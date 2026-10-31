import type http from 'node:http'

import type { StorageDaemonServer } from '@/services/storage/daemon-service.server'

type Fault = {
  purpose: string
  mode: 'unavailable' | 'hold'
  requestId?: string
  generated?: boolean
  aborted?: boolean
  released?: boolean
  release: () => void
  wait: Promise<void>
}

/** Opt-in fault injection and a second authenticated storage client; never bundled into the product. */
export function createSmokeControl(daemon: StorageDaemonServer, enabled: boolean, trace: unknown[]) {
  const faults: Fault[] = []
  const rpc = async (method: string, args: unknown[]) => {
    const response = await fetch(`http://127.0.0.1:${daemon.port}/api/storage/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-chaya-auth-token': daemon.authToken },
      body: JSON.stringify({ method, args }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(body))
    return body.value
  }
  return {
    async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
      if (!enabled || request.url !== '/__smoke/control') return false
      try {
        let raw = ''
        for await (const chunk of request) {
          raw += chunk.toString()
          if (raw.length > 16 * 1024) throw new Error('Smoke control request too large')
        }
        const body = raw ? JSON.parse(raw) : {}
        let value: unknown
        if (body.action === 'arm') {
          if (!['companion-chat', 'companion-tactic-deep', 'companion-tactic-quick'].includes(body.purpose) || !['hold', 'unavailable'].includes(body.mode))
            throw new Error('Invalid smoke fault')
          let release!: () => void
          const wait = new Promise<void>((resolve) => {
            release = resolve
          })
          faults.push({ purpose: body.purpose, mode: body.mode, wait, release })
        } else if (body.action === 'release') {
          for (const fault of faults) {
            fault.released = true
            fault.release()
          }
        } else if (body.action === 'rpc') {
          if (!['companion.state', 'companion.load', 'companion.manage', 'companion.commit'].includes(body.method)) throw new Error('Unsupported smoke RPC')
          value = await rpc(body.method, body.args)
        } else if (body.action && body.action !== 'status') throw new Error('Unknown smoke control action')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ value, faults: faults.map(({ release: _release, wait: _wait, ...fault }) => fault) }))
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: String(error) }))
      }
      return true
    },
    begin(body: { purpose: string; requestId: string }, signal: AbortSignal) {
      const fault = faults.find((entry) => !entry.requestId && entry.purpose === body.purpose)
      if (!fault) return null
      fault.requestId = body.requestId
      trace.push({ type: 'smoke.fault', at: Date.now(), purpose: fault.purpose, mode: fault.mode, requestId: fault.requestId })
      signal.addEventListener(
        'abort',
        () => {
          fault.aborted = true
        },
        { once: true }
      )
      return {
        unavailable: fault.mode === 'unavailable',
        async waitForRelease() {
          fault.generated = true
          // Deliberately retain an actual model result beyond cancellation to test late responses.
          if (fault.mode === 'hold') await fault.wait
          trace.push({ type: 'smoke.released', at: Date.now(), requestId: fault.requestId, clientAborted: signal.aborted })
        },
      }
    },
    close() {
      for (const fault of faults) fault.release()
    },
  }
}
