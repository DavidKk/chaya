import fs from 'node:fs/promises'
import path from 'node:path'

const base = process.env.CHAYA_URL || 'http://localhost:3000'
const gameId = process.env.CHAYA_GAME_ID || 'cfbafc20-c4d9-4b96-ad07-21ce55722678'
const directory = process.env.CHAYA_BENCHMARK_DIR || path.resolve('data/game-agent/benchmarks', new Date().toISOString().replaceAll(':', '-'))
await fs.mkdir(directory, { recursive: true })
const headers = { 'Content-Type': 'application/json', Origin: new URL(base).origin }
const append = async (kind, data) => fs.appendFile(path.join(directory, 'trace.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), kind, data })}\n`)
const request = async (url, body, method = 'POST') => {
  const response = await fetch(`${base}${url}`, { method, headers, signal: AbortSignal.timeout(90_000), ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 1000)}`)
  return response.json()
}
const call = async (name, args = {}) => {
  const response = await request('/api/mcp', { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: { gameId, ...args } } })
  if (response.error || response.result?.isError) throw new Error(JSON.stringify(response.error || response.result))
  const text = response.result?.content?.find((entry) => entry.type === 'text')?.text
  let result
  try {
    result = JSON.parse(text)
  } catch {
    result = text
  }
  await append(name, { input: args, output: result })
  for (const [index, image] of (response.result?.content || []).filter((entry) => entry.type === 'image').entries()) {
    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png'
    await fs.writeFile(path.join(directory, `screenshot-${Date.now()}-${index}.${extension}`), Buffer.from(image.data, 'base64'))
  }
  return result
}
const snapshot = async () => {
  const state = await call('chaya_live_state', { sections: ['map', 'party', 'ui', 'battle'] })
  const edit = await call('chaya_edit_state')
  console.log(JSON.stringify({ scene: state.scene, map: state.map, player: state.player, party: state.party, ui: state.ui, edit }))
}

console.log(`Artifacts: ${directory}`)
const [command = 'snapshot', ...args] = process.argv.slice(2)
if (command === 'call') {
  console.log(JSON.stringify(await call(args[0], args[1] ? JSON.parse(args[1]) : {})))
} else if (command === 'snapshot') {
  await snapshot()
} else if (command === 'start') {
  const status = await request(`/api/game-agent/status?gameId=${encodeURIComponent(gameId)}`, null, 'GET')
  const profile = status.profiles?.find((entry) => entry.id === status.defaultProfileId && entry.online)
  if (!profile?.defaultModel) throw new Error('No configured online model')
  const selection = { profileId: profile.id, model: process.env.CHAYA_MODEL || profile.defaultModel, locale: 'zh-CN', character: 'rei' }
  const route = await request('/api/game-agent/companion', {
    gameId,
    message: {
      type: 'agent.companion.route',
      requestId: crypto.randomUUID(),
      conversationId: `benchmark-${Date.now()}`,
      prompt: process.env.CHAYA_GOAL || '全剧情托管',
      ...selection,
    },
  })
  await append('route', route)
  if (route.result?.kind !== 'control') throw new Error(`No control ticket: ${JSON.stringify(route)}`)
  const result = await request('/api/game-agent/companion', {
    gameId,
    message: { type: 'agent.companion.control.start', requestId: crypto.randomUUID(), ticketId: route.result.ticketId },
  })
  await append('start', result)
  if (result.result?.state === 'failed') throw new Error(result.result.error)
  await fs.writeFile(path.join(directory, 'task.json'), JSON.stringify(result.result))
  console.log(JSON.stringify({ id: result.result?.id, state: result.result?.state, model: selection.model }))
} else if (command === 'load-first') {
  let selectedFile = false
  for (let attempt = 0; attempt < 80; attempt++) {
    const ui = await call('chaya_live_ui')
    let key
    if (ui.scene === 'Scene_Map') {
      if (selectedFile) break
      key = 'cancel'
    } else {
      const desired = { Scene_Menu: 'gameEnd', Scene_GameEnd: 'toTitle', Scene_Title: 'continue' }[ui.scene]
      if (desired) {
        const window = ui.activeWindow
        const option = window?.options?.find((entry) => entry.symbol === desired && entry.enabled)
        if (option) key = window.symbol === desired ? 'ok' : window.index < option.index ? 'down' : 'up'
      } else if (ui.scene === 'Scene_Load') {
        const confirmation = ui.windows?.find((entry) => entry.name === 'confirmWindow' && entry.active)
        const action = ui.windows?.find((entry) => entry.name === 'actionWindow' && entry.active)
        const list = ui.windows?.find((entry) => entry.name === 'listWindow' && entry.active)
        if (list) {
          selectedFile = list.index === 2
          key = selectedFile ? 'ok' : list.index < 2 ? 'down' : 'up'
        } else if (confirmation || action) key = selectedFile ? 'ok' : 'cancel'
      } else throw new Error(`Cannot load File 1 from ${ui.scene}`)
    }
    if (key) await call('chaya_live_press', { key, frames: 1 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (attempt === 79) throw new Error('File 1 load did not settle')
  }
  await snapshot()
} else if (command === 'select') {
  const ui = await call('chaya_live_ui')
  const window = ui.activeWindow
  const option = window?.options?.find((entry) => entry.symbol === args[0])
  if (!option?.enabled) throw new Error(`Unavailable menu command: ${args[0]}`)
  let current = ui
  for (let attempt = 0; attempt < 32 && current.activeWindow?.symbol !== args[0]; attempt++) {
    if (current.scene !== ui.scene || current.activeWindow?.name !== window.name) throw new Error('Menu changed during navigation')
    await call('chaya_live_press', { key: current.activeWindow.index < option.index ? 'down' : 'up', frames: 1 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    current = await call('chaya_live_ui')
  }
  if (current.activeWindow?.symbol !== args[0]) throw new Error('Menu changed before confirmation')
  console.log(JSON.stringify(await call('chaya_live_press', { key: 'ok', frames: 1 })))
} else if (command === 'stop') {
  console.log(JSON.stringify(await request(`/api/game-agent/turn?gameId=${encodeURIComponent(gameId)}`, null, 'DELETE')))
} else if (command === 'observe') {
  const until = Date.now() + Number(args[0] || 45) * 1000
  let afterSeq = 0
  let taskId = process.env.CHAYA_TASK_ID
  if (!taskId) {
    try {
      const task = JSON.parse(await fs.readFile(path.join(directory, 'task.json'), 'utf8'))
      taskId = task.taskId || task.id
    } catch {}
  }
  const seen = new Set()
  while (Date.now() < until) {
    const state = await call('chaya_live_state', { sections: ['map', 'party', 'ui', 'battle'] })
    const history = await call('chaya_live_history', { limit: 100, afterSeq })
    const entries = history.entries || history.history || []
    for (const entry of entries) {
      afterSeq = Math.max(afterSeq, entry.seq || 0)
      console.log('history', JSON.stringify(entry))
    }
    const logs = await call('chaya_logs_query', { view: 'agent', ...(taskId ? { taskId } : {}), limit: 100 })
    const events = logs.events || logs.entries || []
    for (const event of events) {
      const key = JSON.stringify(event)
      if (seen.has(key)) continue
      seen.add(key)
      if (/progress|failed|chest|trap|gameover/.test(event.type || event.eventType || ''))
        console.log('event', JSON.stringify({ seq: event.seq, type: event.type, summary: event.data?.summary, phase: event.data?.phase, eventId: event.data?.detail?.eventId }))
    }
    console.log(
      'state',
      JSON.stringify({
        scene: state.scene,
        map: state.map,
        player: state.player,
        party: state.party?.map(({ id, hp, mhp, mp }) => ({ id, hp, mhp, mp })),
        message: state.message,
        battle: state.battle,
      })
    )
    if (state.scene === 'Scene_Gameover' || ['failed', 'completed', 'cancelled'].includes(logs.task?.state)) break
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
} else {
  throw new Error('Usage: story-benchmark.mjs snapshot | call <MCP tool> <JSON> | start | stop | load-first | select <symbol> | observe [seconds]')
}
