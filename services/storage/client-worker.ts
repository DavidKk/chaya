import { parentPort } from 'node:worker_threads'

parentPort!.on('message', async ({ port, token, body, shared }: { port: number; token: string; body: unknown; shared: SharedArrayBuffer }) => {
  const signal = new Int32Array(shared, 0, 2)
  const started = performance.now()
  const receivedAt = Date.now()
  const { sentAt, requestId } = body as { sentAt?: number; requestId?: string }
  let headersMs = 0
  let httpMs = 0
  let result: unknown
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/storage/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Auth-Token': token, ...(requestId ? { 'X-Chaya-Request-Id': requestId } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    headersMs = Math.round((performance.now() - started) * 10) / 10
    result = await response.json()
    httpMs = Math.round((performance.now() - started) * 10) / 10
    if (!response.ok && !(result as { error?: string })?.error) result = { ...(result as object), error: `Storage HTTP ${response.status}` }
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) }
  }
  const timing = {
    ...(result as { timing?: Record<string, number> })?.timing,
    dispatchMs: typeof sentAt === 'number' ? Math.max(0, receivedAt - sentAt) : 0,
    headersMs,
    httpMs: httpMs || Math.round((performance.now() - started) * 10) / 10,
  }
  let bytes = Buffer.from(JSON.stringify({ ...(result as object), timing }))
  if (bytes.length > shared.byteLength - 8) bytes = Buffer.from(JSON.stringify({ error: 'Storage response exceeds the bounded transport capacity' }))
  new Uint8Array(shared, 8, bytes.length).set(bytes)
  Atomics.store(signal, 1, bytes.length)
  Atomics.store(signal, 0, 1)
  Atomics.notify(signal, 0)
})
