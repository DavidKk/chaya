import { parentPort } from 'node:worker_threads'

parentPort!.on('message', async ({ port, token, body, shared }: { port: number; token: string; body: unknown; shared: SharedArrayBuffer }) => {
  const signal = new Int32Array(shared, 0, 2)
  let result: unknown
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/storage/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Auth-Token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    result = await response.json()
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) }
  }
  let bytes = Buffer.from(JSON.stringify(result))
  if (bytes.length > shared.byteLength - 8) bytes = Buffer.from(JSON.stringify({ error: 'Storage response exceeds the bounded transport capacity' }))
  new Uint8Array(shared, 8, bytes.length).set(bytes)
  Atomics.store(signal, 1, bytes.length)
  Atomics.store(signal, 0, 1)
  Atomics.notify(signal, 0)
})
