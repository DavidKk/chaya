import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import type { PlayerConstraint } from '@/lib/game-agent/companion/core/types'
import type { AgentTask } from '@/lib/game-agent/runtime'
import { installAgentControl } from '@/plugins/mv/src/agent/control'
import { readAgentGameState, startManualInputTracking } from '@/plugins/mv/src/agent/handlers'
import { startHistory } from '@/plugins/mv/src/agent/history'
import { readLiveBattleFrame } from '@/plugins/mv/src/agent/runtime/companion-core/battle-adapter'
import { battleSupportIssue, createBattleCapabilitiesRevision } from '@/plugins/mv/src/agent/runtime/companion-core/battle-support'
import { runBattleTask } from '@/plugins/mv/src/agent/runtime/companion-core/battle-task'
import { CompanionBattleRuntime } from '@/plugins/mv/src/agent/runtime/companion-core/runtime'
import { createCompanionFacts } from '@/plugins/mv/src/agent/runtime/companion-facts'
import { createAgentRuntimeIdentity } from '@/plugins/mv/src/agent/runtime/identity'

// This bridge is bundled only by the opt-in engine smoke tool, never the plugin build.
// Engine globals differ between the official MV and MZ distributions.
const game = globalThis as any
const trace: Array<{ kind: string; at: number; data: any }> = []
const log = (kind: string, data: any) => trace.push({ kind, at: Date.now(), data })
const { identity, producerEpoch } = createAgentRuntimeIdentity(`engine-smoke-${game.Utils.RPGMAKER_NAME}`)
const facts = createCompanionFacts(identity, producerEpoch)
const arbiter = createControlArbiter()
startHistory()
installAgentControl(arbiter, identity.runtimeInstanceId)
startManualInputTracking()
facts.subscribe((event) => log('fact', event))
document.addEventListener('keydown', (event) =>
  log('input', { key: event.key, trusted: event.isTrusted, syntheticHeld: Object.values(game.Input?._currentState ?? {}).some(Boolean) })
)
document.addEventListener('keyup', (event) => log('release', { key: event.key, trusted: event.isTrusted }))
let runtime: CompanionBattleRuntime | undefined
let taskMode = false

game.__companionSmoke = {
  prepare(
    mode: string,
    troopId: number,
    healSkillId?: number,
    fixture: { variables?: Record<string, number>; recoveryLevel?: number; recoverySkill?: number; enemyHp?: number } = {}
  ) {
    taskMode = mode === 'single-battle'
    game.DataManager.setupNewGame()
    game.AudioManager.masterVolume = 0
    const modifications: string[] = ['Third-party plugins disabled by the HTTP fixture', 'Document focus emulated in the hidden automation window']
    for (const [id, value] of Object.entries(fixture.variables ?? {})) {
      if (!Number.isInteger(Number(id)) || Number(id) < 1 || !Number.isFinite(value)) throw new Error('Invalid fixture variable')
      game.$gameVariables.setValue(Number(id), value)
      modifications.push(`Initialize game variable ${id} to ${value}`)
    }
    if (fixture.enemyHp !== undefined) {
      if (!Number.isInteger(fixture.enemyHp) || fixture.enemyHp < 1) throw new Error('Invalid fixture enemy HP')
      for (const member of game.$dataTroops[troopId].members) game.$dataEnemies[member.enemyId].params[0] = fixture.enemyHp
      modifications.push(`Set troop enemy maximum HP to ${fixture.enemyHp} to retain an active battle during injected model delays`)
    }
    if (mode === 'healing' || mode === 'insufficient-mp' || (mode === 'host' && fixture.recoverySkill)) {
      healSkillId ??= fixture.recoverySkill
      if (!game.$gameParty.members().some((actor: any) => actor.actorId() === 2)) {
        game.$gameParty.addActor(2)
        modifications.push('Add actor 2 to the party')
      }
      if (fixture.recoveryLevel !== undefined) {
        if (!Number.isInteger(fixture.recoveryLevel) || fixture.recoveryLevel < 1) throw new Error('Invalid fixture level')
        for (const actor of game.$gameParty.members()) {
          actor.changeLevel(fixture.recoveryLevel, false)
          actor.recoverAll()
        }
        modifications.push(`Set party level to ${fixture.recoveryLevel} and recover before applying the injury fixture`)
      }
      if (healSkillId) {
        const skill = game.$dataSkills[healSkillId]
        if (!skill || skill.damage.type !== 3 || skill.scope !== 7) throw new Error('Expected a single-ally HP recovery skill')
        game.$gameActors.actor(1).learnSkill(healSkillId)
        game.$dataActors[1].traits.push({ code: 41, dataId: skill.stypeId, value: 1 })
        // Published samples sometimes omit assets for unused database animations.
        skill.animationId = 0
        game.$gameActors.actor(2).setHp(Math.max(1, Math.floor(game.$gameActors.actor(2).mhp * 0.09)))
        modifications.push(`Actor 1 learns skill ${healSkillId} with its menu type; animation disabled; actor 2 starts at 9% HP`)
        if (mode === 'insufficient-mp') {
          game.$gameActors.actor(1).setMp(0)
          modifications.push('Actor 1 starts with 0 MP')
        }
      }
    }
    log('fixture', {
      mode,
      engine: game.Utils.RPGMAKER_NAME,
      version: game.Utils.RPGMAKER_VERSION ?? null,
      title: game.$dataSystem.gameTitle,
      troopId,
      healSkillId,
      modifications,
      party: game.$gameParty.members().map((actor: any) => ({ actorId: actor.actorId(), hp: actor.hp, mp: actor.mp })),
    })
    if (mode === 'host') {
      game.SceneManager.goto(game.Scene_Map)
      return
    }
    game.BattleManager.setup(troopId, true, true)
    game.SceneManager.push(game.Scene_Battle)
  },
  start() {
    const issue = battleSupportIssue(true)
    if (issue) throw new Error(issue)
    const deps = {
      runtimeInstanceId: identity.runtimeInstanceId,
      arbiter,
      facts,
      getCapabilitiesRevision: createBattleCapabilitiesRevision(() => facts.current()),
      onRequestDecision: (ticket: unknown) => {
        log('decision', ticket)
      },
      onStatusChange: (status: unknown) => {
        log('status', status)
      },
      onRecord: (event: unknown) => {
        log('record', event)
      },
      onDiagnostic: (event: unknown) => {
        log('diagnostic', event)
      },
      checkSupport: () => battleSupportIssue(),
      onUnsupported: (reason: string) => {
        log('unsupported', reason)
      },
    }
    if (taskMode) {
      const task = { id: 'engine-smoke-single-battle' } as AgentTask
      void runBattleTask(task, new AbortController().signal, {
        ...deps,
        controller: {
          emit: (_id, kind, data) => {
            log('task', { kind, data, scene: game.SceneManager._scene?.constructor.name })
            if (kind === 'progress.updated' && data && typeof data === 'object' && 'diagnostic' in data) log('diagnostic', data.diagnostic)
            if (kind === 'progress.updated' && data && typeof data === 'object' && 'status' in data) log('status', data.status)
            return { seq: trace.length, type: kind, at: Date.now(), data }
          },
          stop: () => {
            log('taskStopped', {})
            return task
          },
          waitForUser: async () => {
            throw new Error('Unexpected user question in the single-battle smoke')
          },
        },
        onRuntime: (battle) => {
          if (battle) runtime = battle
        },
      }).then(
        () => log('taskDone', {}),
        (error) => log('taskError', { message: String(error) })
      )
      return
    }
    runtime = new CompanionBattleRuntime(deps)
    runtime.start()
    runtime.tick()
  },
  stop() {
    runtime?.stop()
    log('stop', {})
  },
  stopWhileHeld() {
    if (!Object.values(game.Input?._currentState ?? {}).some(Boolean)) return false
    log('stopHeld', { ...game.Input._currentState })
    runtime?.stop()
    return true
  },
  constrain(constraint: PlayerConstraint) {
    runtime?.addPlayerConstraint(constraint)
    log('constraint', constraint)
  },
  snapshot() {
    const view = facts.current()
    return {
      scene: game.SceneManager._scene?.constructor.name,
      focused: document.hasFocus(),
      status: runtime?.getStatus(),
      lease: arbiter.currentLease(),
      frame: readLiveBattleFrame(view.stamp, 1, view.current.encounterId.value || ''),
      state: readAgentGameState(),
      heldKeys: game.Input?._currentState,
      trace,
    }
  },
}
