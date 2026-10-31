// Run after pnpm build and plugin builds: pnpm exec tsx scripts/tools/companion-production-smoke.cts <game-root> <new-output-dir> [troop-id]
import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

async function unusedPort() {
  const probe = net.createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = (probe.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await done
  clearTimeout(force)
}

async function main() {
  const [rootArg, outputArg, troopArg = '1'] = process.argv.slice(2)
  assert(rootArg && outputArg && Number.isInteger(Number(troopArg)) && Number(troopArg) > 0, 'Expected game root, new output directory and troop ID')
  const gameRoot = path.resolve(rootArg)
  const output = path.resolve(outputArg)
  await fs.access(path.join(gameRoot, 'index.html'))
  await fs.mkdir(output)
  process.env.CHAYA_DATA_DIR = path.join(output, 'data')
  const { mcpPortConfigDir, processMcpPortEnv } = await import('@/lib/integration/mcp-port')
  const locatorPath = path.join(mcpPortConfigDir(processMcpPortEnv(os.homedir())), 'storage-runtime.json')
  const originalLocator = await fs.readFile(locatorPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  const { startStorageDaemon } = await import('@/services/storage/daemon-service.server')
  const { issueLaunchToken } = await import('@/services/runtime/launch-token')
  const { normalizeGameAgentProfile } = await import('@/services/game-agent/settings')
  const daemon = await startStorageDaemon({ dataDir: process.env.CHAYA_DATA_DIR, port: 0 })
  let next: ChildProcess | undefined
  let game: ChildProcess | undefined
  const log = await fs.open(path.join(output, 'next.log'), 'w')
  const profile = normalizeGameAgentProfile({
    id: 'production-local',
    provider: 'ollama',
    endpoint: process.env.CHAYA_SMOKE_OLLAMA || 'http://127.0.0.1:11434',
    defaultModel: process.env.CHAYA_SMOKE_MODEL || 'qwen3:4b-instruct-2507-q4_K_M',
    keepAlive: '-1',
  })
  try {
    const mountedResponse = await fetch(`http://127.0.0.1:${daemon.port}/api/storage/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chaya-Auth-Token': daemon.authToken },
      body: JSON.stringify({ method: 'game.mount', args: [gameRoot] }),
    })
    const mounted = (await mountedResponse.json()) as { value: { gameId: string } }
    assert(mountedResponse.ok && mounted.value?.gameId, JSON.stringify(mounted))
    const launch = issueLaunchToken({ gameRoot, libraryId: mounted.value.gameId })
    assert.equal(launch.persistence, 'durable')
    const port = await unusedPort()
    const apiBase = `http://127.0.0.1:${port}`
    next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
      env: { ...process.env, PORT: String(port), CHAYA_SERVICE: 'local' },
      stdio: ['ignore', log.fd, log.fd],
    })
    const deadline = Date.now() + 45_000
    let ready = false
    while (Date.now() < deadline) {
      if (next.exitCode !== null || next.signalCode !== null) throw new Error('Next exited during startup; see next.log')
      ready = await fetch(`${apiBase}/api/integration/game-agent/tools`, { signal: AbortSignal.timeout(1_000) })
        .then((response) => response.ok)
        .catch(() => false)
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert(ready, 'Production Next server became ready')
    async function api(route: string, body: unknown, method = 'PUT') {
      const response = await fetch(`${apiBase}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      assert(response.ok, JSON.stringify(result))
      return result
    }
    await api('/api/integration/game-agent', { settings: { version: 1, profiles: [profile], defaultProfileId: profile.id } })
    await api('/api/integration/game-agent', { action: 'models', profile }, 'POST')
    await api('/api/integration/game-agent/tools', { patch: { companionEnabled: false } })
    const configPath = path.join(output, 'private-config.json')
    await fs.writeFile(configPath, JSON.stringify({ gameRoot, apiBase, gameId: launch.libraryId, token: launch.token, profile, troopId: Number(troopArg) }), { mode: 0o600 })
    const electron = createRequire(__filename)('electron') as string
    game = spawn(electron, [path.join(__dirname, 'companion-production-window.cjs'), configPath, output], {
      env: process.env,
      stdio: 'inherit',
    })
    const result = await new Promise<number | null>((resolve, reject) => {
      game!.once('error', reject)
      game!.once('exit', resolve)
    })
    assert.equal(result, 0, 'Production UI and game acceptance')
    const models = await fetch(`${profile.endpoint}/api/ps`).then((response) => response.json())
    await fs.writeFile(path.join(output, 'model-residency.json'), JSON.stringify(models, null, 2) + '\n')
  } finally {
    await stop(game)
    await stop(next)
    await log.close()
    await daemon.close()
    const current = await fs.readFile(locatorPath).catch(() => undefined)
    // Next publishes its locator even with an existing daemon. Restore only our own write.
    if (current && JSON.parse(current.toString()).dataDir === process.env.CHAYA_DATA_DIR) {
      if (originalLocator) await fs.writeFile(locatorPath, originalLocator, { mode: 0o600 })
      else await fs.rm(locatorPath)
    }
    await fs.rm(path.join(output, 'private-config.json'), { force: true })
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
