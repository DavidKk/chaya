'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

exports.runHostPanelScenario = async function ({ evaluate, waitFor, delay, save, mark, troopId, output, config }) {
  const endpoint = `${config.apiBase}/__smoke/panels`
  const state = async () => (await fetch(`${endpoint}/state`)).json()
  const network = (offline) => fetch(`${endpoint}/network`, { method: 'POST', body: JSON.stringify({ offline }) })
  const phase = async (value) => {
    await fs.writeFile(path.join(output, 'panel-ready.json'), JSON.stringify({ url: endpoint, phase: value }) + '\n')
    console.log(`Panel phase: ${value}; ${endpoint}`)
  }
  const until = async (condition) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      if (await condition(await state())) return
      await delay(250)
    }
    throw new Error('Timed out waiting for real panel interaction')
  }
  const rpc = async (method, args) => (await evaluate(`__companionHostSmoke.control(${JSON.stringify({ action: 'rpc', method, args })})`)).value
  const manage = async (gameId, action) => {
    const current = await rpc('companion.state', [gameId])
    return rpc('companion.manage', [
      gameId,
      { requestId: crypto.randomUUID(), expectedMemoryEpoch: current.memoryEpoch, expectedRecordingRevision: current.recordingRevision, ...action },
    ])
  }
  const inputCount = (snapshot) => snapshot.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length
  await evaluate('__companionHostSmoke.recover()')
  await evaluate(`__companionHostSmoke.battle(${troopId})`)
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")
  const route = await evaluate("__companionHostSmoke.route('请一直帮我处理遇到的战斗，直到我叫停。')")
  assert.equal(route.kind, 'control', JSON.stringify(route))
  const task = await evaluate(`__companionHostSmoke.request({type:'agent.companion.control.start',ticketId:${JSON.stringify(route.ticketId)}})`)
  const initial = await save('panels-initial')
  const gameId = initial.gameId
  await phase('turn-recording-off-in-second-tab')
  await until((value) => value.history.some((item) => item.type === 'agent.memory.settings' && item.recording === false))
  await delay(2400)
  const offStart = await rpc('companion.load', [gameId])
  const before = await save('panels-off-start')
  for (let second = 0; second < 8; second++) await delay(1000)
  const offEnd = await rpc('companion.load', [gameId])
  const after = await save('panels-off-end')
  assert.deepEqual(offEnd.battleRecording, offStart.battleRecording)
  assert(after.engine.trace.slice(before.engine.trace.length).some((event) => event.kind === 'fact' && event.data.kind === 'action'))
  assert.equal(after.tasks.find((item) => item.id === task.id).state, 'running')
  mark('second-panel-off-with-gameplay-passed')
  await phase('turn-recording-on-in-first-tab')
  await until((value) => value.history.some((item) => item.type === 'agent.memory.settings' && item.recording === true))
  const onAt = (await state()).history.find((item) => item.type === 'agent.memory.settings' && item.recording === true).at
  await waitFor(`(async()=> (await __companionHostSmoke.stored()).battleRecording.recentEvents.some(e=>e.at>=${onAt}))()`, 15000)
  const resumed = await rpc('companion.load', [gameId])
  const previousIds = new Set(offEnd.battleRecording.recentEvents.map((event) => event.eventId))
  const added = resumed.battleRecording.recentEvents.filter((event) => !previousIds.has(event.eventId))
  assert(added.length > 0)
  assert(added.every((event) => event.at >= onAt))
  mark('second-panel-on-without-backfill-passed', { events: added.length })

  // Break the actual host-to-storage TCP path; management uses a second direct authenticated client.
  await network(true)
  const disconnected = await save('panels-disconnected')
  const cleared = await manage(gameId, { action: 'clear', episodes: true })
  await manage(gameId, { action: 'set_recording', enabled: false })
  const empty = await rpc('companion.load', [gameId])
  for (let second = 0; second < 8; second++) await delay(1000)
  const offline = await save('panels-offline')
  assert.equal(offline.status.memory.epoch, disconnected.status.memory.epoch, 'Host actually missed the management update')
  assert((await state()).failures > 0, 'Real TCP calls failed')
  assert(inputCount(offline) > inputCount(disconnected), 'Local gameplay continued without storage')
  await network(false)
  await waitFor(`(async()=> {const s=(await __companionHostSmoke.status()).status; return s.memory.epoch===${cleared.memoryEpoch} && !s.memory.recording})()`, 15000)
  await delay(3000)
  const reconnected = await save('panels-reconnected')
  const durable = await rpc('companion.load', [gameId])
  assert.deepEqual(durable.battleRecording, empty.battleRecording, 'Offline stale batches cannot reappear after clearing and reconnecting')
  assert.equal(reconnected.tasks.find((item) => item.id === task.id).state, 'running')
  mark('storage-disconnect-reconnect-barrier-passed', { epoch: cleared.memoryEpoch, failedRequests: (await state()).failures })
  await phase('verify-both-tabs-off-with-new-epoch-then-finish')
  await until((value) => value.accepted)
  await evaluate(`__companionHostSmoke.request({type:'agent.task.stop',taskId:${JSON.stringify(task.id)}})`)
  const stopped = await save('panels-stopped')
  await delay(1200)
  const final = await save('panels-final')
  assert.equal(inputCount(final), inputCount(stopped))
  assert.equal(Object.values(final.engine.heldKeys).some(Boolean), false)
  mark('panels-stopped-without-more-input')
}
