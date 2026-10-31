import './companion-engine-bridge.cts'

import { COMPANION_LOCAL_EVENT } from '@/lib/runtime/companion-protocol'
import { readAgentGameState } from '@/plugins/mv/src/agent/handlers'
import { createGameAgentRuntime } from '@/plugins/mv/src/agent/runtime/host'
import { pluginStorageCall } from '@/plugins/mv/src/helpers/storage/client'

const game = globalThis as any
const events: any[] = []
let host: ReturnType<typeof createGameAgentRuntime> | undefined
let selection: { profileId: string; model: string; locale: string; character: string }
let gameId: string
let apiBase: string
let panelTimer: ReturnType<typeof setTimeout> | undefined
let panelsClosed = false
const conversationId = 'official-host-acceptance'
const originalMapLoaded = game.Scene_Map.prototype.onMapLoaded
game.Scene_Map.prototype.onMapLoaded = function (...args: any[]) {
  // Isolate standard battle and map waiting from the sample's opening story.
  game.$dataMap.events = []
  return originalMapLoaded.apply(this, args)
}
window.addEventListener(COMPANION_LOCAL_EVENT, (event: Event) => events.push((event as CustomEvent).detail))

async function pollPanels() {
  if (panelsClosed || !host) return
  try {
    const response = await fetch(`${apiBase}/__smoke/panels/poll`)
    const jobs = (await response.json()) as Array<{ id: number; message: any }>
    for (const job of jobs) {
      if (panelsClosed || !host) break
      let result: { value: unknown } | { error: string }
      try {
        result = { value: await host.request(job.message) }
      } catch (error) {
        result = { error: String(error) }
      }
      await fetch(`${apiBase}/__smoke/panels/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, ...result }),
      })
    }
  } catch {
    // The test server can close while the game is disposing.
  } finally {
    if (!panelsClosed) panelTimer = setTimeout(() => void pollPanels(), 100)
  }
}

game.__companionHostSmoke = {
  async boot(config: { apiBase: string; settings: any; gameRoot: string; panels?: boolean }) {
    const mounted = await pluginStorageCall<{ gameId: string }>('game.mount', [config.gameRoot])
    gameId = mounted.gameId
    apiBase = config.apiBase
    game.CHAYA_GAME_ID = gameId
    game.CHAYA_API_BASE = config.apiBase
    const profile = config.settings.profiles[0]
    selection = { profileId: profile.id, model: profile.defaultModel, locale: 'zh', character: 'rin' }
    host = createGameAgentRuntime(gameId)
    await host.request({ type: 'agent.config.put', requestId: crypto.randomUUID(), config: config.settings })
    await host.request({ type: 'agent.memory.settings', requestId: crypto.randomUUID(), naturalEnhancement: false })
    if (config.panels) void pollPanels()
    return this.status()
  },
  request(message: any) {
    if (!host) throw new Error('Host not booted')
    return host.request({ requestId: crypto.randomUUID(), ...message })
  },
  async control(input: unknown = {}) {
    const response = await fetch(`${apiBase}/__smoke/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(result))
    return result
  },
  route(prompt: string) {
    return this.request({ type: 'agent.companion.route', ...selection, conversationId, prompt })
  },
  legacy(prompt: string) {
    return this.request({
      type: 'agent.task.start',
      ...selection,
      taskId: crypto.randomUUID(),
      deadlineAt: Date.now() + 10_000,
      gameId,
      conversationId,
      surface: 'companion',
      capability: 'play',
      goal: prompt,
      lifetime: 'goal',
      thinking: false,
    })
  },
  checkpoint() {
    return game.JsonEx.stringify(game.DataManager.makeSaveContents())
  },
  restoreCheckpoint(contents: string) {
    if (game.SceneManager._scene.constructor.name !== 'Scene_Map') throw new Error('Restore only on the idle map')
    game.DataManager.extractSaveContents(game.JsonEx.parse(contents))
    const restored = game.JsonEx.stringify(game.DataManager.makeSaveContents())
    game.SceneManager.goto(game.Scene_Map)
    return restored
  },
  async chat(prompt: string) {
    const { stamp } = await this.request({ type: 'agent.companion.status' })
    const requestId = crypto.randomUUID()
    await this.request({ type: 'agent.companion.chat', requestId, ...selection, conversationId, prompt, stamp })
    return requestId
  },
  battle(troopId: number) {
    if (game.SceneManager._scene.constructor.name !== 'Scene_Map') throw new Error('Expected real map before starting the next encounter')
    game.BattleManager.setup(troopId, true, true)
    game.SceneManager.push(game.Scene_Battle)
  },
  recover(injuredActorId?: number) {
    for (const actor of game.$gameParty.members()) actor.recoverAll()
    if (injuredActorId !== undefined) {
      const actor = game.$gameActors.actor(injuredActorId)
      actor.setHp(Math.max(1, Math.floor(actor.mhp * 0.09)))
    }
  },
  async stored() {
    // Wait for the actual asynchronous recording writer rather than substituting its state.
    return pluginStorageCall('companion.load', [gameId])
  },
  async status() {
    return {
      gameId,
      scene: game.SceneManager._scene?.constructor.name,
      sceneDebug: {
        next: game.SceneManager._nextScene?.constructor.name,
        started: game.SceneManager._scene?.isStarted?.() ?? game.SceneManager._sceneStarted,
        active: game.SceneManager._scene?.isActive(),
        busy: game.SceneManager._scene?.isBusy(),
        fadeDuration: game.SceneManager._scene?._fadeDuration,
        waitCount: game.SceneManager._scene?._waitCount,
        encounterEffectDuration: game.SceneManager._scene?._encounterEffectDuration,
        transferring: game.$gamePlayer?.isTransferring(),
      },
      state: readAgentGameState(),
      abilities: game.$gameParty.members().map((actor: any) => ({
        actorId: actor.actorId(),
        skillTypes: actor.addedSkillTypes(),
        skills: actor.skills().map((skill: any) => ({
          id: skill.id,
          type: skill.stypeId,
          occasion: skill.occasion,
          canUse: actor.canUse(skill),
          effect: skill.damage.type,
          mp: actor.skillMpCost(skill),
        })),
      })),
      tasks: host?.controller.list(),
      status: host ? await this.request({ type: 'agent.companion.status' }) : null,
      events,
      engine: game.__companionSmoke.snapshot(),
    }
  },
  async dispose() {
    panelsClosed = true
    clearTimeout(panelTimer)
    host?.dispose()
    host = undefined
  },
}
