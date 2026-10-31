'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

exports.runHostScenario = async function ({ window, evaluate, waitFor, delay, output, origin, bundle, config, troopId, fixture }) {
  const milestones = []
  const mark = (name, data = {}) => {
    milestones.push({ name, at: Date.now(), ...data })
    console.log(name)
  }
  const save = async (name) => {
    const state = await evaluate('__companionHostSmoke.status()')
    await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify({ milestones, ...state }, null, 2) + '\n')
    await fs.writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
    return state
  }
  try {
    await window.loadURL(origin)
    await evaluate("Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true }); true")
    await waitFor("globalThis.SceneManager?._scene?.constructor.name === 'Scene_Title' && DataManager.isDatabaseLoaded()", 60000)
    await evaluate(bundle + '\n;true')
    await evaluate(`__companionSmoke.prepare('host',${troopId},undefined,${JSON.stringify(fixture)})`)
    await waitFor(
      "SceneManager._scene?.constructor.name === 'Scene_Map' && (SceneManager._scene.isStarted?.() ?? SceneManager._sceneStarted) && !SceneManager._scene.isBusy() && !SceneManager.isSceneChanging() && !$gamePlayer.isTransferring()"
    )
    await evaluate(`__companionHostSmoke.boot(${JSON.stringify(config)})`)
    mark('host-ready-on-map')
    if (fixture.hostScenario === 'benchmark') {
      const { runHostBenchmark } = require('./companion-host-benchmark.cjs')
      await runHostBenchmark({ window, evaluate, waitFor, delay, output, origin, bundle, config, troopId, fixture, save, mark })
      mark('host-acceptance-passed')
      await fs.writeFile(path.join(output, 'host-summary.json'), JSON.stringify(milestones, null, 2) + '\n')
      return
    }
    if (fixture.hostScenario === 'stagnation') {
      await runStagnationScenario({ evaluate, waitFor, delay, save, mark, troopId })
      mark('host-acceptance-passed')
      await fs.writeFile(path.join(output, 'host-summary.json'), JSON.stringify(milestones, null, 2) + '\n')
      return
    }
    if (fixture.hostScenario === 'panels') {
      const { runHostPanelScenario } = require('./companion-host-panels.cjs')
      await runHostPanelScenario({ evaluate, waitFor, delay, save, mark, troopId, output, config })
      mark('host-acceptance-passed')
      await fs.writeFile(path.join(output, 'host-summary.json'), JSON.stringify(milestones, null, 2) + '\n')
      return
    }
    if (['faults', 'memory'].includes(fixture.hostScenario)) {
      const { runHostFaultScenario } = require('./companion-host-faults.cjs')
      await runHostFaultScenario({ window, evaluate, waitFor, delay, save, mark, troopId, fixture })
      mark('host-acceptance-passed')
      await fs.writeFile(path.join(output, 'host-summary.json'), JSON.stringify(milestones, null, 2) + '\n')
      return
    }
    if (fixture.hostScenario === 'dynamic') {
      await runDynamicScenario({ evaluate, waitFor, delay, save, mark, troopId, fixture })
      mark('host-acceptance-passed')
      await fs.writeFile(path.join(output, 'host-summary.json'), JSON.stringify(milestones, null, 2) + '\n')
      return
    }
    await evaluate(`__companionHostSmoke.battle(${troopId})`)
    await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")
    const route = await evaluate("__companionHostSmoke.route('请一直帮我处理遇到的战斗，直到我叫停。')")
    assert.equal(route.kind, 'control', JSON.stringify(route))
    assert.equal(route.lifetime, 'until_stopped')
    const task = await evaluate(`__companionHostSmoke.request({type:'agent.companion.control.start',ticketId:${JSON.stringify(route.ticketId)}})`)
    mark('control-started', { taskId: task.id })
    await waitFor("(async()=> (await __companionHostSmoke.status()).tasks.some(t=>t.events.some(e=>e.data?.diagnostic?.phase==='navigation')))()")
    const chatId = await evaluate("__companionHostSmoke.chat('战斗交给你啦，陪我说句话就好。')")
    mark('chat-sent-during-battle', { chatId })
    await waitFor(`(async()=> (await __companionHostSmoke.status()).events.some(e=>e.requestId===${JSON.stringify(chatId)} && ['completed','failed'].includes(e.kind)))()`, 20000)
    const during = await save('host-during-battle')
    const chat = during.events.find((event) => event.requestId === chatId && ['completed', 'failed'].includes(event.kind))
    assert.equal(chat.kind, 'completed', JSON.stringify(chat))
    assert(chat.text?.length > 0, 'Real model chat reached the host')
    await waitFor("SceneManager._scene?.constructor.name === 'Scene_Map'", 120000)
    const afterFirst = await save('host-first-battle')
    assert.equal(afterFirst.tasks.find((item) => item.id === task.id).state, 'running')
    assert(afterFirst.engine.trace.some((event) => event.kind === 'fact' && event.data.kind === 'battle_result' && event.data.outcome === 'win'))
    mark('first-battle-won')
    const before = afterFirst.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length
    // Poll in short intervals: no blocking minute-long sleep or new game window.
    const mapWaitSeconds = fixture.hostScenario === 'experience' ? 1 : 65
    for (let second = 0; second < mapWaitSeconds; second++) {
      await delay(1000)
      if (second === 30) console.log('Still waiting on map; no second game instance')
    }
    const waiting = await save('host-map-wait')
    assert.equal(waiting.scene, 'Scene_Map')
    assert.equal(waiting.tasks.find((item) => item.id === task.id).state, 'running')
    assert.equal(waiting.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length, before)
    assert.equal(Object.values(waiting.engine.heldKeys).some(Boolean), false)
    mark('map-wait-passed', { seconds: mapWaitSeconds })
    await evaluate('__companionHostSmoke.recover()')
    await evaluate(`__companionHostSmoke.battle(${troopId})`)
    await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle'")
    if (fixture.hostScenario !== 'experience') {
      const adjustment = await evaluate("__companionHostSmoke.route('接下来保留至少 50 点 MP。')")
      assert.equal(adjustment.kind, 'clarification', JSON.stringify(adjustment))
      assert(adjustment.text.includes('已更新'), 'Host accepted the real model constraint')
      mark('dynamic-constraint-applied', { adjustment })
    }
    await waitFor("SceneManager._scene?.constructor.name === 'Scene_Map'", 120000)
    mark('second-battle-finished')
    await waitFor('(async()=> {const s=await __companionHostSmoke.stored(); return s.battleRecording?.statistics.reduce((n,x)=>n+x.win,0)>=2})()', 15000)
    const stored = await evaluate('__companionHostSmoke.stored()')
    await fs.writeFile(path.join(output, 'host-stored.json'), JSON.stringify(stored, null, 2) + '\n')
    const observed = stored.battleRecording.recentEvents.find(
      (event) => event.kind === 'action_result' && event.result.evidence?.target.kind === 'enemy' && event.result.evidence?.ability
    )
    assert(observed, 'Actual engine evidence reached durable recording')
    const facts = observed.result.evidence
    const query = await evaluate(
      `__companionHostSmoke.request({type:'agent.memory.query',filter:${JSON.stringify({ enemyIds: [facts.target.id], skillIds: [facts.ability.id], limit: 10 })}})`
    )
    const experience = query.episodes.find((episode) => episode.kind === 'battle_result' && episode.encounterId === observed.encounterId)
    assert(experience, 'Acknowledged recording is retrievable through the real host')
    assert.equal(experience.outcome, 'win')
    assert.equal(experience.completeness, 'partial')
    assert(experience.evidence.some((item) => item.resultId === facts.resultId && item.hpBefore === facts.hpBefore && item.hpAfter === facts.hpAfter))
    assert.equal(
      query.episodes.filter((episode) => episode.kind === 'battle_result' && episode.encounterId === observed.encounterId).length,
      1,
      'Canonical and legacy experiences merge'
    )
    await fs.writeFile(path.join(output, 'host-memory-query.json'), JSON.stringify(query, null, 2) + '\n')
    mark('recorded-experience-query-passed', { episodeId: experience.episodeId, enemyId: facts.target.id, skillId: facts.ability.id })
    if (fixture.hostScenario === 'experience') {
      const requestId = await evaluate(
        "__companionHostSmoke.chat('请引用 experiences 中第一条实际 HP 观察，只返回 JSON，blocks 中包含一个 experience_ref，experienceId 必须使用提供的 ID。')"
      )
      await waitFor(
        `(async()=> (await __companionHostSmoke.status()).events.some(e=>e.requestId===${JSON.stringify(requestId)} && ['completed','failed'].includes(e.kind)))()`,
        30000
      )
      const result = await save('host-hp-experience-chat')
      const reply = result.events.find((event) => event.requestId === requestId && ['completed', 'failed'].includes(event.kind))
      assert.equal(reply.kind, 'completed', JSON.stringify(reply))
      assert(reply.text.includes('实际 HP 减少量'), 'System-rendered HP experience reached chat')
      mark('hp-experience-chat-passed', { requestId, text: reply.text })
    }
    await evaluate(`__companionHostSmoke.request({type:'agent.task.stop',taskId:${JSON.stringify(task.id)}})`)
    const stopped = await save('host-stopped')
    assert.equal(stopped.tasks.find((item) => item.id === task.id).state, 'stopped')
    const keyCount = stopped.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length
    await delay(1200)
    const final = await save('host-final')
    assert.equal(final.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length, keyCount)
    assert.equal(Object.values(final.engine.heldKeys).some(Boolean), false)
    mark('host-acceptance-passed')
    await fs.writeFile(path.join(output, 'host-summary.json'), JSON.stringify(milestones, null, 2) + '\n')
  } catch (error) {
    await save('host-failed').catch(() => {})
    throw error
  } finally {
    await evaluate('__companionHostSmoke.dispose()').catch(() => {})
  }
}

async function runStagnationScenario({ evaluate, waitFor, delay, save, mark, troopId }) {
  // Recreate the level-one state from the captured MZ failure, without raising levels or altering enemies.
  await evaluate('$gameActors.actor(1).setHp(5); $gameActors.actor(1).setMp(0); $gameActors.actor(2).setHp(0); true')
  await save('stagnation-fixture')
  await evaluate(`__companionHostSmoke.battle(${troopId})`)
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")
  const route = await evaluate("__companionHostSmoke.route('请一直帮我处理遇到的战斗，直到我叫停。')")
  assert.equal(route.kind, 'control', JSON.stringify(route))
  const task = await evaluate(`__companionHostSmoke.request({type:'agent.companion.control.start',ticketId:${JSON.stringify(route.ticketId)}})`)
  await waitFor(
    `(async()=> {const s=await __companionHostSmoke.status(); return s.tasks.find(t=>t.id===${JSON.stringify(task.id)})?.state==='waiting_user' || s.scene!=='Scene_Battle'})()`,
    90000
  )
  const result = await save('stagnation-result')
  const current = result.tasks.find((item) => item.id === task.id)
  assert.equal(current.state, 'waiting_user', 'Default guard loop asks the player before continuing')
  assert(
    current.events.some((event) => JSON.stringify(event.data).includes('连续多个回合仅执行保命防御')),
    'Paused for observed defensive stagnation'
  )
  const before = result.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length
  await delay(1500)
  const after = await save('stagnation-paused')
  assert.equal(after.engine.trace.filter((event) => event.kind === 'input' && !event.data.trusted).length, before)
  assert.equal(Object.values(after.engine.heldKeys).some(Boolean), false)
  mark('bounded-defensive-stagnation-passed')
  await evaluate(`__companionHostSmoke.request({type:'agent.task.stop',taskId:${JSON.stringify(task.id)}})`)
}

async function runDynamicScenario({ evaluate, waitFor, delay, save, mark, troopId, fixture }) {
  assert(Number.isInteger(fixture.recoverySkill), 'Dynamic scenario requires a real recovery skill')
  await evaluate(`__companionHostSmoke.battle(${troopId})`)
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle' && !!SceneManager._scene._actorCommandWindow")
  const route = await evaluate("__companionHostSmoke.route('请一直帮我处理遇到的战斗，直到我叫停。')")
  assert.equal(route.kind, 'control', JSON.stringify(route))
  const task = await evaluate(`__companionHostSmoke.request({type:'agent.companion.control.start',ticketId:${JSON.stringify(route.ticketId)}})`)
  mark('dynamic-control-started', { taskId: task.id })
  await save('dynamic-started')
  await waitFor(
    `__companionSmoke.snapshot().trace.some(e=>e.kind==='fact' && e.data.kind==='action' && e.data.ability?.id===${fixture.recoverySkill} && e.data.hpAfter>e.data.hpBefore)`
  )
  mark('baseline-engine-healed')
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Map' && (SceneManager._scene.isStarted?.() ?? SceneManager._sceneStarted) && !SceneManager.isSceneChanging()")
  const baseline = await save('dynamic-baseline')
  const healer = baseline.engine.trace.find(
    (e) => e.kind === 'fact' && e.data.kind === 'action' && e.data.ability?.id === fixture.recoverySkill && e.data.hpAfter > e.data.hpBefore
  ).data.source.id
  await evaluate('__companionHostSmoke.recover(2)')
  const before = await save('dynamic-before-constraint')
  const mpBefore = before.state.party.find((a) => a.id === healer).mp
  const adjustment = await evaluate("__companionHostSmoke.route('接下来保留至少 999 点 MP。')")
  assert.equal(adjustment.kind, 'clarification', JSON.stringify(adjustment))
  assert(adjustment.text.includes('已更新'), JSON.stringify(adjustment))
  mark('dynamic-reserve-applied', { adjustment, healer, mpBefore })
  const factCount = before.engine.trace.length
  await evaluate(`__companionHostSmoke.battle(${troopId})`)
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Battle'")
  await waitFor("SceneManager._scene?.constructor.name === 'Scene_Map'", 120000)
  const after = await save('dynamic-after-constraint')
  const facts = after.engine.trace.slice(factCount).filter((e) => e.kind === 'fact')
  const actions = facts.filter((e) => e.data.kind === 'action' && e.data.source?.kind === 'actor')
  assert(actions.length > 0, 'Real engine executed party actions after constraint')
  assert(!actions.some((e) => e.data.ability?.id === fixture.recoverySkill), 'Reserved MP prevents real recovery skill use')
  assert(
    facts.some((e) => e.data.kind === 'battle_result' && e.data.outcome === 'win'),
    'Local battle continues under new constraint'
  )
  assert.equal(after.state.party.find((a) => a.id === healer).mp, mpBefore, 'Engine MP remains unspent')
  mark('dynamic-engine-behavior-passed', { actions: actions.map((e) => e.data.ability), mpBefore, mpAfter: after.state.party.find((a) => a.id === healer).mp })
  await evaluate(`__companionHostSmoke.request({type:'agent.task.stop',taskId:${JSON.stringify(task.id)}})`)
  const stopped = await save('dynamic-stopped')
  assert.equal(stopped.tasks.find((item) => item.id === task.id).state, 'stopped')
  const keys = stopped.engine.trace.filter((e) => e.kind === 'input' && !e.data.trusted).length
  await delay(1200)
  const final = await save('dynamic-final')
  assert.equal(final.engine.trace.filter((e) => e.kind === 'input' && !e.data.trusted).length, keys)
  assert.equal(Object.values(final.engine.heldKeys).some(Boolean), false)
}
