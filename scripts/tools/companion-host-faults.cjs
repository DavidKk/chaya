'use strict'

const assert = require('node:assert/strict')

exports.runHostFaultScenario = async function ({ window, evaluate, waitFor, delay, save, mark, troopId, fixture }) {
  const control = (input) => evaluate(`__companionHostSmoke.control(${JSON.stringify(input)})`)
  const taskById = (snapshot, task) => snapshot.tasks.find((item) => item.id === task.id)
  const inputCount = (snapshot) => snapshot.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length
  const start = async () => {
    const route = await evaluate("__companionHostSmoke.route('请一直帮我处理遇到的战斗，直到我叫停。')")
    assert.equal(route.kind, 'control', JSON.stringify(route))
    const task = await evaluate(`__companionHostSmoke.request({type:'agent.companion.control.start',ticketId:${JSON.stringify(route.ticketId)}})`)
    await waitFor(`(async()=> (await __companionHostSmoke.status()).tasks.find(t=>t.id===${JSON.stringify(task.id)})?.events.some(e=>e.data?.diagnostic?.phase==='navigation'))()`)
    return task
  }
  const injure = () => evaluate('$gameActors.actor(2).setHp(Math.max(1,Math.floor($gameActors.actor(2).mhp*0.45))); true')
  const arm = (mode, purpose = 'companion-tactic-deep') => control({ action: 'arm', mode, purpose })
  // A request starts only at a legal input opportunity; allow that wait before the model's own budget.
  const generated = () => waitFor("(async()=> (await __companionHostSmoke.control()).faults.some(f=>f.mode==='hold' && !f.released && f.generated))()", 60000)
  const requested = () => waitFor("(async()=> (await __companionHostSmoke.control()).faults.some(f=>f.mode==='hold' && !f.released && f.requestId && !f.aborted))()", 60000)
  const assertStopped = async (task, label) => {
    await waitFor(`(async()=> (await __companionHostSmoke.status()).tasks.find(t=>t.id===${JSON.stringify(task.id)})?.state==='stopped')()`)
    await delay(300)
    const before = await save(`${label}-stopped`)
    await control({ action: 'release' })
    await delay(1500)
    const after = await save(`${label}-late`)
    assert.equal(taskById(after, task).state, 'stopped')
    assert.equal(inputCount(after), inputCount(before), 'Delayed model output cannot restart input')
    assert.equal(Object.values(after.engine.heldKeys).some(Boolean), false)
    assert(!taskById(after, task).events.some((event) => event.data?.decision?.accepted), 'Stopped task cannot accept a delayed patch')
    mark(`${label}-passed`)
  }

  await evaluate('__companionHostSmoke.recover()')
  await evaluate(`__companionHostSmoke.battle(${troopId})`)
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")

  if (fixture.hostScenario === 'memory') {
    const task = await start()
    await arm('hold')
    await injure()
    await generated()
    await arm('hold', 'companion-chat')
    const chatId = await evaluate("__companionHostSmoke.chat('我有点紧张，陪我说句话。')")
    await waitFor("(async()=> (await __companionHostSmoke.control()).faults.some(f=>f.purpose==='companion-chat' && f.generated))()", 20000)
    const before = await save('memory-before-clear')
    const gameId = before.gameId
    const rpc = async (method, args) => (await control({ action: 'rpc', method, args })).value
    const manage = async (action) => {
      const state = await rpc('companion.state', [gameId])
      return rpc('companion.manage', [
        gameId,
        { requestId: `second-client-${Date.now()}`, expectedMemoryEpoch: state.memoryEpoch, expectedRecordingRevision: state.recordingRevision, ...action },
      ])
    }
    const state = await manage({ action: 'clear', episodes: true })
    await waitFor(`(async()=> (await __companionHostSmoke.status()).status.memory.epoch===${state.memoryEpoch})()`, 6000)
    await delay(300)
    await control({ action: 'release' })
    await waitFor(`(async()=> (await __companionHostSmoke.status()).tasks.find(t=>t.id===${JSON.stringify(task.id)})?.events.some(e=>e.data?.decision?.accepted===false))()`, 6000)
    const cleared = await save('memory-after-clear')
    assert(!cleared.events.some((event) => event.requestId === chatId && event.kind === 'completed'), 'Pre-clear chat cannot complete')
    assert(!taskById(cleared, task).events.some((event) => event.data?.decision?.accepted), 'Pre-clear tactic cannot be accepted')
    mark('second-client-clear-fenced-chat-and-tactic', { epoch: state.memoryEpoch })

    await manage({ action: 'set_recording', enabled: false })
    await waitFor('(async()=> !(await __companionHostSmoke.status()).status.memory.recording)()', 6000)
    // Allow the in-flight transport and synchronization poll to settle before taking the baseline.
    await delay(2400)
    const offStart = await rpc('companion.load', [gameId])
    const traceStart = (await evaluate('__companionHostSmoke.status()')).engine.trace.length
    for (let second = 0; second < 8; second++) await delay(1000)
    const offEnd = await rpc('companion.load', [gameId])
    const off = await save('memory-recording-off')
    assert(
      off.engine.trace.slice(traceStart).some((event) => event.kind === 'fact' && event.data.kind === 'action'),
      'Gameplay continued while recording was off'
    )
    assert.deepEqual(offEnd.battleRecording, offStart.battleRecording, 'Disabled interval added no durable battle events or statistics')
    mark('second-client-recording-off-passed')

    const onAt = Date.now()
    const beforeIds = new Set(offEnd.battleRecording.recentEvents.map((event) => event.eventId))
    await manage({ action: 'set_recording', enabled: true })
    await waitFor('(async()=> (await __companionHostSmoke.status()).status.memory.recording)()', 6000)
    await waitFor(`(async()=> (await __companionHostSmoke.stored()).battleRecording.recentEvents.some(e=>e.at>=${onAt}))()`, 15000)
    const resumed = await rpc('companion.load', [gameId])
    const added = resumed.battleRecording.recentEvents.filter((event) => !beforeIds.has(event.eventId))
    assert(added.length > 0)
    assert(
      added.every((event) => event.at >= onAt),
      'Re-enable must not backfill the disabled interval'
    )
    mark('second-client-recording-resumed-without-backfill', { events: added.length })
    await evaluate(`__companionHostSmoke.request({type:'agent.task.stop',taskId:${JSON.stringify(task.id)}})`)
    await assertStopped(task, 'memory')
    return
  }

  let task = await start()
  await arm('unavailable')
  const before = await save('outage-before')
  await injure()
  await waitFor(
    `(async()=> (await __companionHostSmoke.status()).tasks.find(t=>t.id===${JSON.stringify(task.id)})?.events.some(e=>e.data?.decision?.reason?.includes('Injected model outage')))()`
  )
  await waitFor(`(async()=> (await __companionHostSmoke.status()).engine.trace.filter(e=>e.kind==='input' && !e.data.trusted).length>${inputCount(before) + 2})()`)
  assert.equal(taskById(await save('outage-after'), task).state, 'running')
  mark('model-outage-local-battle-continued')

  await evaluate('__companionHostSmoke.recover()')
  await delay(300)
  await arm('hold')
  await injure()
  await generated()
  mark('timeout-real-model-result-held')
  await waitFor(
    `(async()=> (await __companionHostSmoke.status()).tasks.find(t=>t.id===${JSON.stringify(task.id)})?.events.some(e=>e.data?.decision?.accepted===false && /timed out|timeout|TimeoutError/i.test(e.data.decision.reason)))()`,
    35000
  )
  await control({ action: 'release' })
  const timedOut = await save('timeout-after-release')
  assert(!taskById(timedOut, task).events.some((event) => event.data?.decision?.accepted))
  assert.equal(taskById(timedOut, task).state, 'running')
  mark('model-timeout-late-output-rejected')

  await evaluate('__companionHostSmoke.recover()')
  await delay(1500)
  await arm('hold')
  await injure()
  await requested()
  await evaluate(`__companionHostSmoke.request({type:'agent.task.stop',taskId:${JSON.stringify(task.id)}})`)
  await assertStopped(task, 'model-running-stop')

  await evaluate('__companionHostSmoke.recover()')
  task = await start()
  await arm('hold')
  await injure()
  await requested()
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await assertStopped(task, 'model-running-manual-takeover')
}
