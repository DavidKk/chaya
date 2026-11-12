import { mcpPortConfigDir, processMcpPortEnv } from '@/lib/integration/mcp-port'

import { tryNodeRequire } from '../node/node-require'

type Locator = { dataDir: string; entry: string; executable: string; root: string }
type Meta = { port: number; authToken: string }

function runtime() {
  const req = tryNodeRequire()
  if (!req) throw new Error('Local storage requires a Node game host')
  const fs = req('fs') as typeof import('node:fs')
  const path = req('path') as typeof import('node:path')
  const os = req('os') as typeof import('node:os')
  let locator: Locator | undefined
  try {
    locator = JSON.parse(fs.readFileSync(path.join(mcpPortConfigDir(processMcpPortEnv(os.homedir())), 'storage-runtime.json'), 'utf8')) as Locator
  } catch {
    /* Explicit environment is also supported by development launchers. */
  }
  const dataDir = process.env.CHAYA_DATA_DIR || locator?.dataDir
  if (!dataDir) throw new Error('Start the Chaya app once so the shared storage service can initialize')
  return { req, fs, path, locator, dataDir }
}

/** Only a locator for rebuildable public views; it contains no game assets or credentials. */
export function pluginPublicGameDirectory(root: string): string | null {
  try {
    const { fs, path, dataDir } = runtime()
    const registry = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime/game-directories.json'), 'utf8')) as Record<string, { directory: string }>
    return registry[fs.realpathSync(root)]?.directory || null
  } catch {
    return null
  }
}

async function metadata(): Promise<Meta> {
  const { req, fs, path, locator, dataDir } = runtime()
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime/storage-daemon.json'), 'utf8')) as Meta & { pid: number }
      process.kill(value.pid, 0)
      if (value.port > 0) return value
    } catch {
      /* Recover an exited service using its installed Node runtime. */
    }
    return null
  }
  const current = read()
  if (current) return current
  if (!locator || !fs.existsSync(locator.entry)) throw new Error('Local storage service is not running; open the Chaya app')
  const child = (req('child_process') as typeof import('node:child_process')).spawn(locator.executable, [locator.entry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHAYA_DATA_DIR: dataDir, CHAYA_ROOT: locator.root },
  })
  let failure: Error | undefined
  child.once('error', (error) => {
    failure = error
  })
  child.unref()
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure
    const value = read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Local storage service did not start in time')
}

/** Node HTTP keeps credentials on loopback, independently of the console's Local/Cloud URL. */
export async function pluginStorageCall<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
  const meta = await metadata()
  const { req } = runtime()
  const http = req('http') as typeof import('node:http')
  return new Promise<T>((resolve, reject) => {
    const body = JSON.stringify({ method, args })
    const request = http.request(
      {
        host: '127.0.0.1',
        port: meta.port,
        path: '/api/storage/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Chaya-Auth-Token': meta.authToken, 'Content-Length': Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 16 * 1024 * 1024) {
            response.destroy(new Error('Storage response exceeds 16 MiB'))
            return
          }
          chunks.push(chunk)
        })
        response.once('error', reject)
        response.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { value: T; error?: string; code?: string }
            if (response.statusCode !== 200 || value.error) {
              return reject(Object.assign(new Error(value.error || 'Storage request failed'), typeof value.code === 'string' ? { code: value.code } : {}))
            }
            resolve(value.value)
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.setTimeout(25000, () => request.destroy(new Error('Storage request timed out')))
    request.once('error', reject)
    request.end(body)
  })
}
