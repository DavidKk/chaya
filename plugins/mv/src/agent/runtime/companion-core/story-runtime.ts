import { isBattleResultContext, setSkipBattleResult, trySkipBattleResult } from '../../../cheat/runtime/skip-battle-result'
import { AGENT_MANUAL_INPUT_EVENT, readAgentGameState } from '../../handlers'
import type { InteractIo } from '../../interact'
import type { CompanionComplete } from '../companion-chat'
import { CompanionBanterEngine } from './story-banter'
import { StoryContextStore } from './story-context'
import { StoryDriver } from './story-driver'
import { type ExplorationTarget, StoryExplorationPlanner } from './story-exploration'
import { type ModelThoughtEvent, StoryPuzzleSolver } from './story-puzzle-solver'

export type StoryRuntimePhase =
  | 'title'
  | 'dialogue'
  | 'choice'
  | 'exploring'
  | 'battle'
  | 'stuck_recovery'
  | 'paused'
  | 'idle'
  | 'completed'
  | 'thought'

export type StoryProgressUpdate = {
  phase: StoryRuntimePhase
  summary: string
  detail?: unknown
}

export type StoryRuntimeDeps = {
  complete?: CompanionComplete
  profileId?: string
  model?: string
  character?: string
  locale?: string
  signal: AbortSignal
  onProgress?: (update: StoryProgressUpdate) => void
  onThought?: (thought: ModelThoughtEvent) => void
}

class StuckDetector {
  private lastPosition: { mapId: number; x: number; y: number } | null = null
  private lastChangeTime = Date.now()
  private readonly thresholdMs: number

  constructor(thresholdMs = 25_000) {
    this.thresholdMs = thresholdMs
  }

  public update(mapId: number, x: number, y: number): boolean {
    const now = Date.now()
    if (!this.lastPosition || this.lastPosition.mapId !== mapId || this.lastPosition.x !== x || this.lastPosition.y !== y) {
      this.lastPosition = { mapId, x, y }
      this.lastChangeTime = now
      return false
    }
    return now - this.lastChangeTime > this.thresholdMs
  }

  public reset(): void {
    this.lastPosition = null
    this.lastChangeTime = Date.now()
  }
}

export class CompanionStoryRuntime {
  private readonly driver: StoryDriver
  private readonly planner: StoryExplorationPlanner
  private readonly puzzleSolver: StoryPuzzleSolver
  private readonly banter: CompanionBanterEngine
  private readonly stuckDetector = new StuckDetector(25_000)
  private pausedUntil = 0
  private active = false
  private inBattle = false
  private lastMapId: number | null = null
  private bgTimer: ReturnType<typeof setInterval> | null = null
  private cleanups: Array<() => void> = []
  private lastPhase: StoryRuntimePhase | null = null
  private lastSummary = ''
  private prologueMilestoneAnnounced = false
  private battleEndSteps = 0
  private eventRunningTicks = 0
  private watchdogTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: StoryRuntimeDeps) {
    const forwardThought = (thought: ModelThoughtEvent) => {
      this.deps.onThought?.(thought)
      this.emit('thought', `大模型完成推理：${thought.decision || ''}`, thought)
    }
    this.driver = new StoryDriver({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      signal: deps.signal,
      onThought: forwardThought,
    })
    this.puzzleSolver = new StoryPuzzleSolver({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      signal: deps.signal,
      onThought: forwardThought,
    })
    this.planner = new StoryExplorationPlanner(this.puzzleSolver)
    this.banter = new CompanionBanterEngine({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      character: deps.character,
      locale: deps.locale,
      signal: deps.signal,
      onBanter: (line) => {
        this.emit('dialogue', `旅伴说：“${line}”`)
      },
    })
  }

  private emit(phase: StoryRuntimePhase, summary: string, detail?: unknown): void {
    if (this.lastPhase === phase && this.lastSummary === summary) return
    this.lastPhase = phase
    this.lastSummary = summary
    this.deps.onProgress?.({ phase, summary, detail })
  }

  private isPreempted(): boolean {
    return Date.now() < this.pausedUntil
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private playerGuidance: { text: string; receivedAt: number; consumed: boolean } | null = null

  public isActive(): boolean {
    return this.active
  }

  public getPhase(): StoryRuntimePhase {
    return this.lastPhase ?? "idle"
  }

  public getSummary(): string {
    return this.lastSummary
  }

  public applyPlayerGuidance(text: string): void {
    const clean = text.trim()
    if (!clean) return
    this.playerGuidance = { text: clean, receivedAt: Date.now(), consumed: false }
    const curMapId = (globalThis as any).$gameMap?.mapId?.() ?? 0
    StoryContextStore.recordGlobalAction(curMapId, `收到玩家建议：“${clean}”`, "guidance")
    this.emit("exploring", `收到你的建议：“${clean}”，正在调整探索决策…`)
    this.planner.clearTargetAttempts()
  }

  public getPlayerGuidance(): string | null {
    if (!this.playerGuidance || this.playerGuidance.consumed) return null
    if (Date.now() - this.playerGuidance.receivedAt > 120_000) {
      this.playerGuidance = null
      return null
    }
    return this.playerGuidance.text
  }

  public getChatContext(): { active: boolean; phase: string; summary: string; guidance?: string } {
    return {
      active: this.active,
      phase: this.lastPhase ?? "exploring",
      summary: this.lastSummary,
      guidance: this.getPlayerGuidance() ?? undefined,
    }
  }

  public start(): Promise<void> {
    if (this.active) return Promise.resolve()
    this.active = true
    setSkipBattleResult(true)

    // Preemption listener: manual player keys pause custody for 3s
    if (typeof window !== 'undefined') {
      const onManualInput = () => {
        this.pausedUntil = Date.now() + 3_000
        this.emit('paused', '检测到玩家手动操作，托管暂停 3 秒…')
      }
      window.addEventListener(AGENT_MANUAL_INPUT_EVENT, onManualInput)
      this.cleanups.push(() => window.removeEventListener(AGENT_MANUAL_INPUT_EVENT, onManualInput))

      // Background pump for SceneManager when window is not focused
      this.bgTimer = setInterval(() => {
        const g = globalThis as any
        if (typeof document !== 'undefined' && document.hidden && g.SceneManager && !g.SceneManager._stopped && typeof g.SceneManager.update === 'function') {
          g.SceneManager.update()
        }
      }, 16)
      this.cleanups.push(() => {
        if (this.bgTimer) clearInterval(this.bgTimer)
        this.bgTimer = null
      })

      this.watchdogTimer = setInterval(() => {
        this.runWatchdogHeartbeat()
      }, 1500)
      this.cleanups.push(() => {
        if (this.watchdogTimer) clearInterval(this.watchdogTimer)
        this.watchdogTimer = null
        setSkipBattleResult(false)
      })
    }

    return this.runLoop()
  }

  public stop(): void {
    this.active = false
    setSkipBattleResult(false)
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    this.emit('idle', '托管已停止')
  }

  private async runLoop(): Promise<void> {
    const g = globalThis as any

    while (this.active && !this.deps.signal.aborted) {
      try {
        // 1. Handle player preemption pause
      if (this.isPreempted()) {
        await this.sleep(200)
        continue
      }

      const scene = g.SceneManager?._scene
      const sceneName = scene?.constructor?.name as string | undefined

      if (!scene) {
        await this.sleep(100)
        continue
      }

      // 2. Gameover scene -> restart to Title
      if (sceneName === 'Scene_Gameover') {
        this.emit('title', '检测到 Gameover 界面，正在返回标题…')
        if (typeof scene.gotoTitle === 'function') scene.gotoTitle()
        await this.sleep(1000)
        continue
      }

      // Sub-scenes / Stray menus -> pop back to Map
      if (sceneName && sceneName.startsWith('Scene_') && !['Scene_Map', 'Scene_Battle', 'Scene_Title', 'Scene_Gameover'].includes(sceneName)) {
        this.emit('exploring', `检测到停留在界面 ${sceneName}，自动返回游戏地图…`)
        this.simulateKey('escape')
        if (typeof scene.popScene === 'function') scene.popScene()
        await this.sleep(300)
        continue
      }

      // 3. Title scene -> Auto New Game
      if (sceneName === 'Scene_Title') {
        this.emit('title', '标题界面：自动开始新游戏…')
        if (typeof scene.commandNewGame === 'function') {
          scene.commandNewGame()
        }
        await this.sleep(800)
        continue
      }

      // 4. Battle scene -> High-Speed Local Battle Resolution
      if (sceneName === 'Scene_Battle') {
        if (!this.inBattle) {
          this.inBattle = true
          this.banter.trigger('battle_start')
        }
        this.emit('battle', '战斗接管中：本地高速战斗核心正在歼灭敌人…')
        this.resolveBattleStep(scene)
        await this.sleep(50)
        continue
      } else if (this.inBattle) {
        this.inBattle = false
        this.banter.trigger('battle_win')
        const curMapId = g.$gameMap?.mapId?.() ?? 0
        StoryContextStore.recordGlobalAction(curMapId, '遭遇战胜利，击败敌方怪物', 'battle')
      }

      // 5. Map scene -> Dialogue, Choices & Exploration
      if (sceneName === 'Scene_Map') {
        const curMapId = g.$gameMap?.mapId?.() ?? null
        if (curMapId !== null && curMapId !== this.lastMapId) {
          const fromId = this.lastMapId
          this.lastMapId = curMapId
          this.banter.trigger('map_transition', { mapId: curMapId })
          if (fromId !== null) {
            const player = g.$gamePlayer
            const arrivalPos = player ? { x: Number(player.x), y: Number(player.y) } : undefined
            StoryContextStore.recordTransition({
              fromMapId: fromId,
              toMapId: curMapId,
              arrivalPos,
              timestamp: Date.now(),
            })
          }
        }

        // Map 215: Prologue Act Selection
        if (curMapId === 215) {
          this.emit('exploring', '序章章节选择中：确认开始第一幕…')
          this.simulateKey('ok')
          await this.sleep(400)
          continue
        }

        const message = g.$gameMessage
        const messageWindow = scene._messageWindow

        // 5a. Branch choices popup
        if (message && typeof message.isChoice === 'function' && message.isChoice()) {
          const choices = (typeof message.choices === 'function' ? message.choices() : []) as string[]
          if (choices.length > 0) {
            const mapId = g.$gameMap?.mapId?.() ?? null
            this.emit('choice', `决策选择中：正在仲裁分支选项 [${choices.join(' / ')}]…`)
            const pickedIdx = await this.driver.resolveChoice(choices, mapId, this.getPlayerGuidance())
            this.driver.applyChoiceSelection(messageWindow, pickedIdx)
            await this.sleep(300)
            continue
          }
        }

        // 5b. Dialogue message & map events running
        const isMsgPause = Boolean(messageWindow && messageWindow.visible && messageWindow.pause)
        const isMsgBusy = Boolean(message && typeof message.isBusy === 'function' && message.isBusy())
        const isEventRunning = Boolean(g.$gameMap && typeof g.$gameMap.isEventRunning === 'function' && g.$gameMap.isEventRunning())

        if (isMsgPause || isMsgBusy || isEventRunning) {
          if (messageWindow) {
            this.emit('dialogue', '对话推进中：自动快进与自然停顿阅读…')
            const advanced = this.driver.tickMessageWindow(messageWindow)
            if (advanced || isMsgPause) {
              this.simulateKey('ok')
            }
          }
          if (isEventRunning && (!messageWindow || !messageWindow.visible)) {
            this.eventRunningTicks = (this.eventRunningTicks || 0) + 1
            if (this.eventRunningTicks > 5) {
              this.simulateKey('ok')
              this.eventRunningTicks = 0
            }
          } else {
            this.eventRunningTicks = 0
          }
          await this.sleep(60)
          continue
        }

        // 5d. Player free exploration
        const player = g.$gamePlayer
        const canMove = player && typeof player.canMove === 'function' ? player.canMove() : false

        if (canMove) {
          const mapId = g.$gameMap?.mapId?.() ?? 0
          const px = Number(player.x)
          const py = Number(player.y)

          // Stuck check
          if (this.stuckDetector.update(mapId, px, py)) {
            this.emit('stuck_recovery', '检测到行进停滞，正在执行自救脱困…')
            await this.executeStuckJitter(player)
            this.stuckDetector.reset()
            await this.sleep(300)
            continue
          }

          // Check for prologue climax completion on Map 6
          if (mapId === 6) {
            const switches = g.$gameSwitches
            if (switches && (switches.value(24) || switches.value(25)) && !this.prologueMilestoneAnnounced) {
              this.prologueMilestoneAnnounced = true
              this.banter.trigger('milestone')
              StoryContextStore.recordMilestone(mapId, '🎉 序章试炼已顺利通关！')
              this.emit('exploring', '🎉 序章试炼已顺利通关！托管自律推进中，继续探索后续场景…')
            }
          }

          // Next target from exploration planner
          const guidance = this.getPlayerGuidance()
          let target = this.planner.findNextTarget(mapId, { x: px, y: py }, guidance)

          const isStuck = this.stuckDetector.update(mapId, px, py)
          if (!target || isStuck) {
            this.emit('exploring', '正在结合剧情对话与地图环境，调用大模型分析下一步主线推进策略…')
            target = await this.planner.resolvePuzzleTarget(mapId, { x: px, y: py }, this.driver.getRecentHistory(10), guidance)
            if (target) {
              this.banter.trigger('puzzle', { detail: target.hint })
              this.emit('exploring', `大模型分析推理：${target.hint || target.name} (${target.x}, ${target.y})…`)
            } else if (isStuck) {
              this.emit('stuck_recovery', '检测到行进停滞，正在执行自救脱困…')
              await this.executeStuckJitter(player)
              this.stuckDetector.reset()
              await this.sleep(300)
              continue
            }
          }

          if (target) {
            const rawDesc = target.hint || target.name || `事件 ${target.eventId}`
            const desc = rawDesc.replace(/^前往\s*/, '')
            this.emit('exploring', target.guided ? `根据你的建议：前往 ${desc} (${target.x}, ${target.y})…` : `地图探索中：前往 ${desc} (${target.x}, ${target.y})…`)

            const io: InteractIo = {
              press: async (key) => {
                this.simulateKey(key)
              },
              readState: readAgentGameState,
              interrupted: () => !this.active || this.deps.signal.aborted || this.isPreempted(),
            }

            const actionRes = await this.planner.executeTarget(target, io, this.deps.signal)
            if (actionRes.success) {
              if (target.guided && this.playerGuidance) {
                this.playerGuidance.consumed = true
              }
              if (target.kind === 'chest') {
                this.banter.trigger('loot', { name: target.name || undefined })
              } else if (target.kind === 'lever') {
                this.banter.trigger('puzzle')
              }
            }
            await this.sleep(200)
            continue
          } else {
            this.emit('exploring', '地图探索中：当前区域暂无新目标，巡航观察中…')
            await this.sleep(500)
            continue
          }
        }
      }

      await this.sleep(100)
      } catch (err) {
        console.warn('[story-runtime] Recovering loop from exception:', err)
        await this.sleep(1000)
      }
    }
  }

  private resolveBattleStep(scene: any): void {
    const g = globalThis as any
    const bm = g.BattleManager
    const troop = g.$gameTroop
    const party = g.$gameParty
    const sm = g.SceneManager

    if (!bm) return
    ensureSafeSceneManagerPop()

    // If SceneManager is already transitioning to another scene (e.g. back to Scene_Map),
    // wait for it without executing more pops or scene mutations.
    if (sm?._nextScene) return

    // 1. Battle End / Victory Resolution
    const isEnding = (typeof bm.isBattleEnd === 'function' && bm.isBattleEnd()) ||
      String(bm._phase) === 'battleEnd' ||
      isBattleResultContext()

    if (isEnding) {
      this.battleEndSteps++
      this.emit('battle', '战斗结算确认中：正在推进胜利结算与掉落物…')
      this.simulateKey('ok')
      trySkipBattleResult()

      if (g.$gameMessage && typeof g.$gameMessage.isBusy === 'function' && g.$gameMessage.isBusy()) {
        if (typeof g.$gameMessage.clear === 'function') g.$gameMessage.clear()
      }
      if (sm?._nextScene) return

      if (String(bm._phase) === 'battleEnd') {
        if (typeof bm.updateBattleEnd === 'function') bm.updateBattleEnd()
      } else if (typeof bm.update === 'function') {
        bm.update()
      }
      if (typeof scene.update === 'function') scene.update()

      // Post-battle safeguard: recover party HP
      if (party && typeof party.members === 'function') {
        for (const m of party.members()) {
          if (m && typeof m.recoverAll === 'function' && m.hp < m.mhp) {
            m.recoverAll()
          }
        }
      }

      // If battle ending is stuck in Scene_Battle for more than 15 steps (~1.2s)
      if (this.battleEndSteps > 15) {
        if (typeof bm.replayBgmAndBgs === 'function') bm.replayBgmAndBgs()
        const hasStack = Array.isArray(sm?._stack) && sm._stack.length > 0
        if (hasStack && typeof sm?.pop === 'function') {
          sm.pop()
        } else if (g.Scene_Map && typeof sm?.goto === 'function') {
          sm.goto(g.Scene_Map)
        }
        this.battleEndSteps = 0
      }
      return
    }

    this.battleEndSteps = 0

    // 2. High-Speed Combat Turn Execution
    let steps = 0
    while (steps < 20 && scene && scene.constructor?.name === 'Scene_Battle') {
      steps++
      if (scene._partyCommandWindow && scene._partyCommandWindow.active) {
        if (typeof scene.commandFight === 'function') scene.commandFight()
      } else if (typeof bm.isInputting === 'function' && bm.isInputting() && typeof bm.inputtingAction === 'function') {
        const action = bm.inputtingAction()
        const members = troop && typeof troop.members === 'function' ? (troop.members() as any[]) : []
        const livingIdx = members.findIndex((e) => e && typeof e.isAlive === 'function' && e.isAlive())
        if (action && livingIdx >= 0) {
          if (typeof action.setAttack === 'function') action.setAttack()
          if (typeof action.setTarget === 'function') action.setTarget(livingIdx)
          const actor = typeof bm.actor === 'function' ? bm.actor() : null
          if (actor && g.$dataSkills && typeof actor.attackSkillId === 'function') {
            actor.setLastBattleSkill(g.$dataSkills[actor.attackSkillId()])
          }
          if (typeof bm.selectNextCommand === 'function') bm.selectNextCommand()
        }
      }
      if (typeof bm.update === 'function') bm.update()
      if (typeof scene.update === 'function') scene.update()
    }
  }

  private runWatchdogHeartbeat(): void {
    ensureSafeSceneManagerPop()
    if (!this.active || this.deps.signal.aborted || this.isPreempted()) return
    const g = globalThis as any
    const scene = g.SceneManager?._scene
    if (!scene) return
    const sceneName = String(scene.constructor?.name || '')

    // Battle stall heartbeat
    if (sceneName === 'Scene_Battle') {
      if (g.SceneManager?._nextScene) return
      trySkipBattleResult()
      const bm = g.BattleManager
      if (bm && (bm.isBattleEnd?.() || String(bm._phase) === 'battleEnd' || isBattleResultContext())) {
        this.simulateKey('ok')
        if (String(bm._phase) === 'battleEnd' && typeof bm.updateBattleEnd === 'function') {
          bm.updateBattleEnd()
        }
      }
      return
    }

    // Sub-scene / menu stall heartbeat
    if (sceneName.startsWith('Scene_') && !['Scene_Map', 'Scene_Battle', 'Scene_Title', 'Scene_Gameover'].includes(sceneName)) {
      this.simulateKey('escape')
      if (typeof scene.popScene === 'function') scene.popScene()
      return
    }

    // Dialogue stall heartbeat on Map
    if (sceneName === 'Scene_Map') {
      const messageWindow = scene._messageWindow
      if (messageWindow && messageWindow.visible && messageWindow.pause) {
        this.simulateKey('ok')
      }
    }
  }

  private async executeStuckJitter(player: any): Promise<void> {
    const directions = [2, 4, 6, 8]
    const randomDir = directions[Math.floor(Math.random() * directions.length)]
    if (player && typeof player.moveStraight === 'function') {
      player.moveStraight(randomDir)
      await this.sleep(300)
    }
  }

  private simulateKey(key: 'ok' | 'escape' | 'cancel' | 'up' | 'down' | 'left' | 'right'): void {
    const g = globalThis as any
    const input = g.Input
    if (!input || !input._currentState) return
    input._currentState[key] = true
    input._previousState = input._previousState || {}
    input._previousState[key] = false
    input._latestButton = key
    input._pressedTime = 0
    if (key === 'escape' || key === 'cancel') {
      input._currentState['escape'] = true
      input._currentState['cancel'] = true
      input._previousState['escape'] = false
      input._previousState['cancel'] = false
    }
    setTimeout(() => {
      if (input._currentState) {
        input._currentState[key] = false
        if (key === 'escape' || key === 'cancel') {
          input._currentState['escape'] = false
          input._currentState['cancel'] = false
        }
      }
    }, 60)
  }

}

export function ensureSafeSceneManagerPop(): void {
  const g = globalThis as any
  const sm = g.SceneManager
  if (!sm || sm.__chayaSafePopInstalled) return
  sm.__chayaSafePopInstalled = true
  const origPop = sm.pop
  sm.pop = function (this: any) {
    if (Array.isArray(this._stack) && this._stack.length > 0) {
      if (typeof origPop === 'function') {
        return origPop.call(this)
      }
      return this.goto(this._stack.pop())
    }
    if (g.Scene_Map && typeof this.goto === 'function') {
      return this.goto(g.Scene_Map)
    }
  }
}
