'use strict'

// pnpm exec electron scripts/tools/companion-engine-smoke.cjs <game-root> <output-dir> [troop-id] [heal-skill-id] [fixture-json]
// Run only against a local MV/MZ sample. No game assets are copied into the repository.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const gameRoot = path.resolve(process.argv[2] || '.')
const output = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chaya-companion-engine-smoke'))
const troopId = Number(process.argv[4] || 1)
const healSkillId = process.argv[5] ? Number(process.argv[5]) : undefined
const fixturePath = process.argv[6]
const hostConfigPath = process.env.CHAYA_COMPANION_HOST_CONFIG
const repoRoot = path.resolve(__dirname, '../..')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}
let window, server, profile
const summaries = []
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function evaluate(code) {
  return window.webContents.executeJavaScript(code, true)
}

async function waitFor(code, timeout = 120000, interval = 100) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const result = await evaluate(code)
    if (result) return result
    await delay(interval)
  }
  throw new Error(`Timed out waiting for ${code}`)
}

async function capture(mode) {
  const snapshot = await evaluate('globalThis.__companionSmoke?.snapshot() ?? { scene: globalThis.SceneManager?._scene?.constructor.name }')
  await fs.writeFile(path.join(output, `${mode}.json`), JSON.stringify(snapshot, null, 2) + '\n')
  await fs.writeFile(path.join(output, `${mode}.png`), (await window.webContents.capturePage()).toPNG())
  return snapshot
}

function summarize(mode, snapshot) {
  const records = snapshot.trace.filter((event) => event.kind === 'record').map((event) => event.data)
  const diagnostics = snapshot.trace.filter((event) => event.kind === 'diagnostic').map((event) => event.data)
  const start = snapshot.trace.find((event) => event.kind === 'status' && event.data === 'running')
  const result = snapshot.trace.find((event) => event.kind === 'fact' && event.data.kind === 'battle_result')
  const selection = diagnostics.filter((event) => event.phase === 'selection')
  const navigation = diagnostics.filter((event) => event.phase === 'navigation')
  return {
    mode,
    fixture: snapshot.trace.find((event) => event.kind === 'fixture')?.data,
    status: snapshot.status,
    result: result?.data,
    battleMs: result && start ? result.at - start.at : null,
    commandCount: records.filter((event) => event.kind === 'command_committed').length,
    keyCount: snapshot.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length,
    decisionRequests: snapshot.trace.filter((event) => event.kind === 'decision').length,
    // The harness wires no model endpoint; service, chat and persistence timings are unmeasured.
    selectionMaxMs: selection.length ? Math.max(...selection.map((event) => event.durationMs)) : null,
    navigationCommittedMs: navigation.filter((event) => event.reason === 'committed').map((event) => event.durationMs),
    navigationFailures: navigation.filter((event) => event.reason !== 'committed'),
  }
}

async function runScenario(mode, bundle, origin, fixture) {
  console.log(`Starting ${mode}`)
  await window.loadURL(origin)
  // MZ gates scene updates on document focus. Emulate that environment in a
  // hidden renderer so the automation neither steals focus nor captures user keys.
  await evaluate("Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true }); true")
  await waitFor("globalThis.SceneManager?._scene?.constructor.name === 'Scene_Title' && DataManager.isDatabaseLoaded()", 60000)
  await evaluate(bundle + '\n;true')
  await evaluate(`__companionSmoke.prepare(${JSON.stringify(mode)},${troopId},${healSkillId ?? 'undefined'},${JSON.stringify(fixture)})`)
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")
  await evaluate('__companionSmoke.start()')
  if (mode === 'stop' || mode === 'manual') {
    // Stop atomically while a press is held. For takeover, verify that Chromium's
    // trusted key actually arrived during a held synthetic press.
    if (mode === 'stop') await waitFor('__companionSmoke.stopWhileHeld()', 10000, 5)
    else {
      await waitFor('Object.values(__companionSmoke.snapshot().heldKeys).some(Boolean)', 10000, 5)
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await waitFor('__companionSmoke.snapshot().state.manualInputEpoch > 0')
    }
    const before = await evaluate("__companionSmoke.snapshot().trace.filter(e => e.kind === 'input' && !e.data.trusted).length")
    await delay(1200)
    const snapshot = await capture(mode)
    assert.equal(snapshot.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length, before, 'No automatic input after stop/takeover')
    assert.equal(snapshot.lease, null, 'Control lease released')
    assert.equal(Object.values(snapshot.heldKeys).some(Boolean), false, 'No held game keys')
    if (mode === 'manual') {
      assert(
        snapshot.trace.some((event) => event.kind === 'input' && event.data.trusted && event.data.syntheticHeld),
        'Real Chromium takeover during synthetic input'
      )
    }
    summaries.push(summarize(mode, snapshot))
  } else {
    await waitFor("__companionSmoke.snapshot().trace.some(e => e.kind === 'record' && e.data.kind === 'command_committed')")
    await capture(`${mode}-running`)
    if (mode === 'healing') {
      await waitFor(
        `__companionSmoke.snapshot().trace.some(e => e.kind === 'fact' && e.data.kind === 'action' && e.data.ability?.id === ${healSkillId} && e.data.hpAfter > e.data.hpBefore)`
      )
      await capture(`${mode}-recovery`)
    }
    await waitFor("__companionSmoke.snapshot().trace.some(e => e.kind === 'fact' && e.data.kind === 'battle_result')")
    await waitFor("SceneManager._scene?.constructor.name !== 'Scene_Battle'", 15000)
    const snapshot = await capture(mode)
    const summary = summarize(mode, snapshot)
    assert.equal(summary.result.outcome, 'win', 'Battle actually won')
    if (mode !== 'insufficient-mp') assert.equal(summary.decisionRequests, 0, 'Ordinary battle requires no model decision')
    else {
      const unexpected = snapshot.trace.filter((event) => event.kind === 'decision' && event.data.reason !== 'sudden_party_damage')
      assert.equal(unexpected.length, 0, 'Only actual danger may request a decision in the low-resource fixture')
    }
    if (mode === 'single-battle') {
      await waitFor("__companionSmoke.snapshot().trace.some(e => e.kind === 'taskDone' || e.kind === 'taskError')", 5000)
      const completed = await capture(mode)
      assert(!completed.trace.some((event) => event.kind === 'taskError'), 'Single-battle task completed without errors')
      assert(
        completed.trace.some((event) => event.kind === 'task' && event.data.kind === 'assistant.completed' && event.data.scene !== 'Scene_Battle'),
        'Task completed only after leaving the battle scene'
      )
      assert.equal(completed.status, 'idle')
      assert.equal(completed.lease, null)
      assert.equal(Object.values(completed.heldKeys).some(Boolean), false)
      summary.status = completed.status
    }
    if (mode === 'healing') {
      const recovery = snapshot.trace.find(
        (event) => event.kind === 'fact' && event.data.kind === 'action' && event.data.ability?.id === healSkillId && event.data.hpAfter > event.data.hpBefore
      )
      assert(recovery, 'Engine applied real HP recovery')
      assert.equal(recovery.data.source.kind, 'actor')
      const initial = summary.fixture.party.find((actor) => actor.actorId === recovery.data.source.id)
      const final = snapshot.state.party.find((actor) => actor.id === recovery.data.source.id)
      assert(final.mp < initial.mp, 'Engine spent MP')
      summary.recovery = recovery.data
      summary.healerActorId = recovery.data.source.id
      summary.mpBefore = initial.mp
      summary.mpAfter = final.mp
    }
    if (mode === 'insufficient-mp') {
      const forbidden = snapshot.trace.filter(
        (event) => event.kind === 'record' && event.data.kind === 'command_committed' && event.data.actionKey === `actor:1:skill:${healSkillId}`
      )
      assert.equal(forbidden.length, 0, 'Unaffordable skill never committed')
    }
    summaries.push(summary)
    await evaluate('__companionSmoke.stop()')
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n')
  console.log(`Passed ${mode}`)
}

async function main() {
  if (!process.argv[2] || !Number.isInteger(troopId) || troopId < 1 || (healSkillId !== undefined && (!Number.isInteger(healSkillId) || healSkillId < 1))) {
    throw new Error('Usage: pnpm exec electron scripts/tools/companion-engine-smoke.cjs <game-root> <output-dir> [positive-troop-id] [positive-heal-skill-id]')
  }
  await fs.access(path.join(gameRoot, 'index.html'))
  const fixture = fixturePath ? JSON.parse(await fs.readFile(path.resolve(fixturePath), 'utf8')) : {}
  await fs.mkdir(output, { recursive: true })
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'chaya-engine-smoke-'))
  app.setPath('userData', profile)
  const bundle = await build({
    entryPoints: [path.join(__dirname, hostConfigPath ? 'companion-host-bridge.cts' : 'companion-engine-bridge.cts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(repoRoot, 'plugins/mv/tsconfig.json'),
    alias: { '@': repoRoot, '@chaya-lib': path.join(repoRoot, 'lib') },
  })
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      if (pathname === '/js/plugins.js') {
        res.setHeader('Content-Type', 'application/javascript')
        res.end('var $plugins = [];')
        return
      }
      const file = path.resolve(gameRoot, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!file.startsWith(gameRoot + path.sep)) {
        res.writeHead(403).end()
        return
      }
      const content = await fs.readFile(file)
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
      if (hostConfigPath && ['/js/rpg_core.js', '/js/rmmz_core.js'].includes(pathname)) {
        // Electron supplies Node for the real storage client, but has no NW.js GUI.
        res.end(Buffer.concat([content, Buffer.from('\nUtils.isNwjs = function() { return false; };\n')]))
        return
      }
      res.end(content)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await app.whenReady()
  window = new BrowserWindow({
    width: 1100,
    height: 850,
    show: false,
    title: 'Chaya companion engine smoke',
    // Full-host acceptance explicitly runs trusted local samples in the Node game host.
    webPreferences: {
      nodeIntegration: !!hostConfigPath,
      contextIsolation: !hostConfigPath,
      backgroundThrottling: false,
      ...(hostConfigPath ? { additionalArguments: [gameRoot] } : {}),
    },
  })
  window.webContents.setAudioMuted(true)
  assert(window.webContents.isAudioMuted(), 'Test games start muted')
  window.webContents.on('console-message', (_event, ...args) => {
    void fs.appendFile(path.join(output, 'console.log'), JSON.stringify(args) + '\n').catch(() => {})
  })
  const origin = `http://127.0.0.1:${server.address().port}/`
  if (hostConfigPath) {
    const config = JSON.parse(await fs.readFile(hostConfigPath, 'utf8'))
    const { runHostScenario } = require('./companion-host-scenario.cjs')
    await runHostScenario({ window, evaluate, waitFor, delay, output, origin, bundle: bundle.outputFiles[0].text, config, troopId, fixture })
    return
  }
  for (const mode of ['baseline', ...(healSkillId ? ['healing', 'insufficient-mp'] : []), 'single-battle', 'stop', 'manual']) {
    try {
      await runScenario(mode, bundle.outputFiles[0].text, origin, fixture)
    } catch (error) {
      await capture(`${mode}-failed`).catch(() => {})
      throw error
    }
  }
  console.log(`All scenarios passed. Evidence: ${output}`)
}

async function finish(code) {
  window?.destroy()
  server?.closeAllConnections()
  server?.close()
  if (profile) await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  app.exit(code)
}

main().then(
  () => finish(0),
  (error) => {
    console.error(error)
    return finish(1)
  }
)
