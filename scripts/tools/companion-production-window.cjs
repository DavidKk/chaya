'use strict'

// Used only by companion-production-smoke.cts: built plugins, real Next routes and a single trusted sample game.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const output = path.resolve(process.argv[3])
const repo = path.resolve(__dirname, '../..')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const startedAt = Date.now()
let game, settings, server, userData, apiBase
const milestones = []
const mark = (name, data = {}) => {
  milestones.push({ name, at: Date.now(), ...data })
  process.stdout.write(`${name}\n`)
}
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression, true)
}

async function waitFor(window, expression, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await evaluate(window, `Promise.resolve(${expression}).then(Boolean)`)
    if (value) return value
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

async function capture(name) {
  const state = await evaluate(
    game,
    `(async () => ({
    scene: SceneManager._scene?.constructor.name,
    events: __productionEvents, inputs: __productionInputs, results: __productionResults,
    panel: document.getElementById('chaya-game-agent-host')?.shadowRoot?.textContent,
    held: Input._currentState,
    tasks: (await ChayaAgent.taskRequest({type:'agent.task.status',requestId:crypto.randomUUID()}))
      .filter(task=>!window.__productionTaskId || task.id===window.__productionTaskId)
      .map(task=>({id:task.id,state:task.state}))
  }))()`
  )
  await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify({ milestones, ...state }, null, 2) + '\n')
  await fs.writeFile(path.join(output, `${name}.png`), (await game.webContents.capturePage()).toPNG())
  return state
}

async function sendChat(text) {
  await waitFor(game, "document.getElementById('chaya-game-agent-host')?.shadowRoot?.querySelector('form input')")
  await evaluate(
    game,
    `(() => {
    const root = document.getElementById('chaya-game-agent-host').shadowRoot;
    const input = root.querySelector('form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`
  )
  await delay(100)
  await evaluate(game, "document.getElementById('chaya-game-agent-host').shadowRoot.querySelector('form').requestSubmit()")
}

async function main() {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
  apiBase = config.apiBase
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'chaya-production-ui-'))
  app.setPath('userData', userData)
  server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (pathname.startsWith('/api/')) {
      const upstream = http.request(
        new URL(request.url, config.apiBase),
        {
          method: request.method,
          headers: request.headers,
        },
        (reply) => {
          response.writeHead(reply.statusCode, reply.headers)
          reply.pipe(response)
        }
      )
      upstream.on('error', () => response.destroy())
      response.once('close', () => upstream.destroy())
      request.pipe(upstream)
      return
    }
    try {
      if (pathname === '/js/plugins.js') {
        response.setHeader('Content-Type', 'application/javascript')
        return response.end('var $plugins = [];')
      }
      const file = path.resolve(config.gameRoot, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!file.startsWith(config.gameRoot + path.sep)) return response.writeHead(403).end()
      let contents = await fs.readFile(file)
      if (['/js/rpg_core.js', '/js/rmmz_core.js'].includes(pathname)) {
        contents = Buffer.concat([contents, Buffer.from('\nUtils.isNwjs = function() { return false; };\n')])
      }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg' }
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
      response.end(contents)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await app.whenReady()
  settings = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { backgroundThrottling: false } })
  game = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, additionalArguments: [config.gameRoot] },
  })
  game.webContents.setAudioMuted(true)
  assert(game.webContents.isAudioMuted(), 'Test games start muted')
  for (const [name, window] of [
    ['settings', settings],
    ['game', game],
  ]) {
    window.webContents.on('console-message', (_event, ...args) => {
      void fs.appendFile(path.join(output, `${name}-console.log`), JSON.stringify(args) + '\n').catch(() => {})
    })
  }
  await settings.loadURL(`${config.apiBase}/assist/companion`)
  await waitFor(settings, 'document.querySelector(\'section button[role="switch"]:not(:disabled)\')')
  assert.equal(await evaluate(settings, "document.querySelector('section button[role=\"switch\"]').getAttribute('aria-checked')"), 'false')
  await evaluate(settings, 'document.querySelector(\'section button[role="switch"]\').click()')
  await waitFor(settings, "document.querySelector('section button[role=\"switch\"]').getAttribute('aria-checked') === 'true'")
  await fs.writeFile(path.join(output, 'settings.png'), (await settings.webContents.capturePage()).toPNG())
  mark('production-settings-enabled')
  const origin = `http://127.0.0.1:${server.address().port}`
  await game.loadURL(origin)
  await evaluate(game, "Object.defineProperty(document,'hasFocus',{value:()=>true,configurable:true});true")
  await waitFor(game, "globalThis.SceneManager?._scene?.constructor.name === 'Scene_Title' && DataManager.isDatabaseLoaded()", 60_000)
  await evaluate(
    game,
    `Object.assign(window,${JSON.stringify({ CHAYA_API_BASE: origin, CHAYA_GAME_ID: config.gameId, CHAYA_LAUNCH_TOKEN: config.token })});
    localStorage.setItem('chaya.game-agent.runtime-selection',${JSON.stringify(JSON.stringify({ profileId: config.profile.id, model: config.profile.defaultModel }))});
    window.__productionEvents=[];window.__productionInputs=[];window.__productionResults=[];
    window.addEventListener('chaya:companion-message',e=>__productionEvents.push(e.detail));
    document.addEventListener('keydown',e=>__productionInputs.push({at:Date.now(),key:e.key,trusted:e.isTrusted}));
    const original=BattleManager.endBattle;
    BattleManager.endBattle=function(result){__productionResults.push({at:Date.now(),result});return original.apply(this,arguments)};
    const mapLoaded=Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded=function(){ $dataMap.events=[];return mapLoaded.apply(this,arguments)};
    DataManager.setupNewGame();AudioManager.masterVolume=0;SceneManager.goto(Scene_Map);true`
  )
  await waitFor(game, "SceneManager._scene?.constructor.name === 'Scene_Map' && !SceneManager.isSceneChanging()")
  for (const plugin of ['ChayaAgent', 'ChayaEdit']) {
    const script = await fs.readFile(path.join(repo, 'plugins/mv/dist', `${plugin}.js`), 'utf8')
    await evaluate(game, `${script}\n;true`)
  }
  await waitFor(game, "!!window.ChayaAgent && !!document.getElementById('chaya-game-agent-host')?.shadowRoot?.querySelector('form input')")
  mark('production-plugins-and-panel-ready')
  async function remote(message) {
    const started = Date.now()
    const response = await fetch(`${config.apiBase}/api/game-agent/companion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: config.gameId, message: { requestId: crypto.randomUUID(), ...message } }),
      signal: AbortSignal.timeout(145_000),
    })
    const body = await response.json()
    assert(response.ok, JSON.stringify(body))
    return { result: body.result, durationMs: Date.now() - started }
  }
  const status = await remote({ type: 'agent.companion.status' })
  assert.equal(status.result.version, 1)
  mark('next-to-game-status', { durationMs: status.durationMs })
  await remote({ type: 'agent.memory.settings', naturalEnhancement: false })
  await evaluate(game, `BattleManager.setup(${config.troopId},true,true);SceneManager.push(Scene_Battle);true`)
  await waitFor(game, "SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")
  const route = await remote({
    type: 'agent.companion.route',
    prompt: '请一直帮我处理遇到的战斗，直到我叫停。',
    conversationId: 'production-control',
    profileId: config.profile.id,
    model: config.profile.defaultModel,
    locale: 'zh',
    character: 'rin',
  })
  assert.equal(route.result.kind, 'control', JSON.stringify(route))
  const task = await remote({ type: 'agent.companion.control.start', ticketId: route.result.ticketId })
  await evaluate(game, `window.__productionTaskId=${JSON.stringify(task.result.id)}`)
  mark('production-control-started', { durationMs: route.durationMs, taskId: task.result.id })
  await waitFor(game, '__productionInputs.some(e=>!e.trusted)')
  const chatAt = Date.now()
  await sendChat('战斗交给你啦，陪我说句话就好。')
  await waitFor(game, "__productionEvents.some(e=>e.kind==='completed'&&e.text?.length)", 45_000)
  const chatting = await capture('production-chat')
  assert(chatting.panel.includes('战斗交给你啦'), 'User text rendered in the real panel')
  assert(
    chatting.inputs.some((input) => !input.trusted && input.at >= chatAt),
    'Local battle continued during chat'
  )
  mark('production-panel-chat-during-battle')
  await waitFor(game, "__productionResults.some(e=>e.result===0) && SceneManager._scene?.constructor.name === 'Scene_Map'", 120_000)
  const won = await capture('production-victory')
  assert(
    won.tasks.some((item) => item.id === task.result.id && item.state === 'running'),
    'Continuous goal waits on map'
  )
  mark('production-battle-won')
  const routeSamples = []
  const cases = [
    ['今天过得怎么样？只想聊聊。', 'chat'],
    ['请一直帮我处理遇到的战斗，直到我叫停。', 'control'],
    ['这场打得怎么样？只说说你的看法。', 'chat'],
    ['帮我打完下一场战斗，结束就停。', 'control'],
    ['你好，陪我说句话。', 'chat'],
    ['请继续代打遇到的战斗，直到我叫停。', 'control'],
  ]
  for (const [prompt, expected] of cases) {
    try {
      const sample = await remote({
        type: 'agent.companion.route',
        prompt,
        conversationId: 'production-route-samples',
        profileId: config.profile.id,
        model: config.profile.defaultModel,
        locale: 'zh',
        character: 'rin',
      })
      routeSamples.push({ prompt, expected, actual: sample.result.kind, durationMs: sample.durationMs, passed: sample.result.kind === expected })
    } catch (error) {
      routeSamples.push({ prompt, expected, passed: false, error: String(error) })
    }
  }
  await fs.writeFile(path.join(output, 'route-samples.json'), JSON.stringify(routeSamples, null, 2) + '\n')
  mark('production-warm-route-samples', { passed: routeSamples.filter((sample) => sample.passed).length, total: cases.length })
  await waitFor(game, 'document.getElementById(\'chaya-game-agent-host\').shadowRoot.querySelector(\'button[aria-label="Stop autopilot"],button[aria-label="停止托管"]\')')
  await evaluate(game, 'document.getElementById(\'chaya-game-agent-host\').shadowRoot.querySelector(\'button[aria-label="Stop autopilot"],button[aria-label="停止托管"]\').click()')
  await waitFor(
    game,
    `(async()=> (await ChayaAgent.taskRequest({type:'agent.task.status',requestId:crypto.randomUUID()})).some(t=>t.id===${JSON.stringify(task.result.id)}&&t.state==='stopped'))()`
  )
  const stopped = await capture('production-stopped')
  await delay(1_200)
  assert.equal(await evaluate(game, '__productionInputs.filter(e=>!e.trusted).length'), stopped.inputs.filter((input) => !input.trusted).length)
  assert(!Object.values(stopped.held).some(Boolean), 'No held inputs after stopping from panel')
  await remote({ type: 'agent.memory.settings', recording: false })
  await waitFor(game, "(async()=> !(await ChayaAgent.taskRequest({type:'agent.companion.status',requestId:crypto.randomUUID()})).memory.recording)()")
  await waitFor(
    game,
    '!!document.getElementById(\'chaya-game-agent-host\').shadowRoot.querySelector(\'button[role="switch"][aria-label="开启游玩记录"],button[role="switch"][aria-label="Turn on play recording"]\')'
  )
  await capture('production-recording-disabled')
  mark('production-stop-and-remote-management-passed')
  assert(
    routeSamples.every((sample) => sample.passed),
    'Warm route samples passed; see route-samples.json'
  )
  mark('production-acceptance-passed')
}

const deadline = setTimeout(() => {
  process.stderr.write('Production smoke deadline exceeded\n')
  app.exit(1)
}, 8 * 60_000)
void main().then(
  () => finish(0),
  async (error) => {
    process.stderr.write(`${error.stack || error}\n`)
    mark('production-acceptance-failed', { error: String(error) })
    if (game && !game.isDestroyed()) await capture('production-failed').catch(() => {})
    await finish(1)
  }
)

async function finish(code) {
  clearTimeout(deadline)
  if (apiBase) {
    await fetch(`${apiBase}/api/logs?source=companion-model&limit=200`, { signal: AbortSignal.timeout(5_000) })
      .then((response) => response.json())
      .then((logs) =>
        fs.writeFile(path.join(output, 'model-logs.json'), JSON.stringify({ afterTs: startedAt, entries: logs.entries.filter((entry) => entry.ts >= startedAt) }, null, 2) + '\n')
      )
      .catch(() => {})
  }
  for (const window of [game, settings]) if (window && !window.isDestroyed()) window.destroy()
  server?.closeAllConnections()
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  if (userData) await fs.rm(userData, { recursive: true, force: true })
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(milestones, null, 2) + '\n')
  app.exit(code)
}
