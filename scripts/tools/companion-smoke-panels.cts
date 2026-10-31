import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { build } from 'esbuild'

import type { StorageDaemonServer } from '@/services/storage/daemon-service.server'

/** Test-only UI bridge and a real failing TCP path, without changing the user's network. */
export async function createSmokePanels(daemon: StorageDaemonServer, output: string, enabled: boolean) {
  let sequence = 0
  let offline = false
  let failures = 0
  let accepted = false
  const history: unknown[] = []
  const queued: Array<{ id: number; message: unknown }> = []
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let script = ''
  let proxy: http.Server | undefined
  if (enabled) {
    const bundle = await build({
      entryPoints: [path.join(__dirname, 'companion-panel-smoke.tsx')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      tsconfig: path.resolve(__dirname, '../../tsconfig.json'),
    })
    script = bundle.outputFiles[0].text
    proxy = http.createServer((request, response) => {
      if (offline) {
        failures++
        request.socket.destroy()
        return
      }
      const upstream = http.request({ host: '127.0.0.1', port: daemon.port, path: request.url, method: request.method, headers: request.headers }, (incoming) => {
        response.writeHead(incoming.statusCode || 502, incoming.headers)
        incoming.pipe(response)
      })
      upstream.on('error', () => response.destroy())
      request.on('error', () => upstream.destroy())
      response.on('close', () => upstream.destroy())
      request.pipe(upstream)
    })
    await new Promise<void>((resolve) => proxy!.listen(0, '127.0.0.1', resolve))
    const metadataPath = path.join(process.env.CHAYA_DATA_DIR!, 'runtime/storage-daemon.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
    await fs.writeFile(metadataPath, JSON.stringify({ ...metadata, port: (proxy.address() as import('node:net').AddressInfo).port }))
  }
  return {
    async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
      const route = request.url?.split('?')[0]
      if (!enabled || !route?.startsWith('/__smoke/panels')) return false
      const json = (value: unknown, code = 200) => response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      try {
        if (route === '/__smoke/panels') {
          response
            .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(
              '<!doctype html><html lang="zh"><meta charset="utf-8"><title>旅伴管理验收</title>' +
                '<style>body{font-family:sans-serif;max-width:720px;margin:48px auto;padding:24px;background:#f8f8f5;color:#242828}button{margin:8px;padding:8px}button[role=switch]{min-width:48px;min-height:28px;border:2px solid #a7b2ac;background:#e0e3e0}button[aria-checked=true]{background:#438870;color:white}svg{vertical-align:middle}</style>' +
                '<div id="root"></div><script src="/__smoke/panels/script.js"></script></html>'
            )
        } else if (route === '/__smoke/panels/script.js') response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(script)
        else if (route === '/__smoke/panels/poll') json(queued.splice(0).filter((job) => pending.has(job.id)))
        else if (route === '/__smoke/panels/state') json({ offline, failures, history, accepted })
        else {
          let raw = ''
          for await (const chunk of request) {
            raw += chunk.toString()
            if (raw.length > 16_384) throw new Error('Panel smoke request too large')
          }
          const body = JSON.parse(raw)
          if (route === '/__smoke/panels/network') {
            offline = body.offline === true
            history.push({ type: 'network', offline, at: Date.now() })
            json({ offline, failures })
          } else if (route === '/__smoke/panels/finish') {
            accepted = true
            json({ accepted })
          } else if (route === '/__smoke/panels/result') {
            const job = pending.get(body.id)
            if (body.error) job?.reject(new Error(body.error))
            else job?.resolve(body.value)
            json({ ok: true })
          } else if (route === '/__smoke/panels/request') {
            if (!['agent.companion.status', 'agent.memory.settings', 'agent.memory.clear'].includes(body.type)) throw new Error('Unsupported panel command')
            const id = ++sequence
            const at = Date.now()
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
              const result = new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject })
                timeout = setTimeout(() => reject(new Error('Panel bridge timeout')), 30_000)
              })
              queued.push({ id, message: body })
              const value = await result
              if (body.type !== 'agent.companion.status') history.push({ type: body.type, recording: body.recording, at })
              json({ value })
            } finally {
              clearTimeout(timeout)
              pending.delete(id)
            }
          } else json({ error: 'Unknown panel endpoint' }, 404)
        }
      } catch (error) {
        json({ error: String(error) }, 500)
      }
      return true
    },
    async close() {
      for (const job of pending.values()) job.reject(new Error('Panel smoke closed'))
      proxy?.closeAllConnections()
      if (proxy) await new Promise<void>((resolve) => proxy!.close(() => resolve()))
      if (enabled) await fs.writeFile(path.join(output, 'panel-transport.json'), JSON.stringify({ failures, history }, null, 2) + '\n')
    },
  }
}
