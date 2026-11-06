import { AGENT_MANUAL_INPUT_EVENT, readAgentGameState } from '../../handlers'
import type { InteractIo } from '../../interact'
import type { CompanionComplete } from '../companion-chat'
import { CompanionBanterEngine } from './story-banter'
import { StoryDriver } from './story-driver'
import { type ExplorationTarget, StoryExplorationPlanner } from './story-exploration'
import { StoryPuzzleSolver } from './story-puzzle-solver'

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

  constructor(private readonly deps: StoryRuntimeDeps) {
    this.driver = new StoryDriver({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      signal: deps.signal,
    })
    this.puzzleSolver = new StoryPuzzleSolver({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      signal: deps.signal,
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

  public start(): Promise<void> {
    if (this.active) return Promise.resolve()
    this.active = true

    // Preemption listener: manual player keys pause custody for 3s
    if (typeof window !== 'undefined') {
      const onManualInput = () => {
        this.pausedUntil = Date.now() + 3_000
        this.emit('paused', '检测到玩家手动操作，全托管暂停 3 秒…')
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
    }

    return this.runLoop()
  }

  public stop(): void {
    this.active = false
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    this.emit('idle', '全托管已停止')
  }

  private async runLoop(): Promise<void> {
    const g = globalThis as any

    while (this.active && !this.deps.signal.aborted) {
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
      }

      // 5. Map scene -> Dialogue, Choices & Exploration
      if (sceneName === 'Scene_Map') {
        const curMapId = g.$gameMap?.mapId?.() ?? null
        if (curMapId !== null && curMapId !== this.lastMapId) {
          this.lastMapId = curMapId
          this.banter.trigger('map_transition', { mapId: curMapId })
        }

        const message = g.$gameMessage
        const messageWindow = scene._messageWindow

        // 5a. Branch choices popup
        if (message && typeof message.isChoice === 'function' && message.isChoice()) {
          const choices = (typeof message.choices === 'function' ? message.choices() : []) as string[]
          if (choices.length > 0) {
            const mapId = g.$gameMap?.mapId?.() ?? null
            this.emit('choice', `决策选择中：正在仲裁分支选项 [${choices.join(' / ')}]…`)
            const pickedIdx = await this.driver.resolveChoice(choices, mapId)
            this.driver.applyChoiceSelection(messageWindow, pickedIdx)
            await this.sleep(300)
            continue
          }
        }

        // 5b. Active dialogue message
        if (messageWindow && messageWindow.visible && typeof messageWindow.isOpenAndActive === 'function' && messageWindow.isOpenAndActive()) {
          this.emit('dialogue', '对话推进中：自动快进与自然停顿阅读…')
          this.driver.tickMessageWindow(messageWindow)
          await this.sleep(60)
          continue
        }

        // 5c. Message busy or map events running
        const isMessageBusy = message && typeof message.isBusy === 'function' && message.isBusy()
        const isEventRunning = g.$gameMap && typeof g.$gameMap.isEventRunning === 'function' && g.$gameMap.isEventRunning()

        if (isMessageBusy || isEventRunning) {
          if (messageWindow) this.driver.tickMessageWindow(messageWindow)
          await this.sleep(80)
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
            if (switches && (switches.value(24) || switches.value(25))) {
              this.banter.trigger('milestone')
              this.emit('completed', '🎉 序章试炼已顺利通关！全托管已完成当前阶段目标。')
              this.stop()
              return
            }
          }

          // Next target from exploration planner
          let target = this.planner.findNextTarget(mapId, { x: px, y: py })
          if (!target) {
            // Try puzzle reasoning when topological candidates are exhausted
            target = await this.planner.resolvePuzzleTarget(mapId, { x: px, y: py }, this.driver.getRecentHistory(10))
            if (target) {
              this.banter.trigger('puzzle', { detail: target.hint })
            }
          }

          if (target) {
            const desc = target.hint || target.name || `事件 ${target.eventId}`
            this.emit('exploring', `地图探索中：前往 ${desc} (${target.x}, ${target.y})…`)

            const io: InteractIo = {
              press: async (key) => {
                this.simulateKey(key)
              },
              readState: readAgentGameState,
              interrupted: () => !this.active || this.deps.signal.aborted || this.isPreempted(),
            }

            const actionRes = await this.planner.executeTarget(target, io, this.deps.signal)
            if (actionRes.success) {
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
    }
  }

  private resolveBattleStep(scene: any): void {
    const g = globalThis as any
    const bm = g.BattleManager
    const troop = g.$gameTroop
    const party = g.$gameParty

    if (!bm) return

    let steps = 0
    while (steps < 20 && scene && scene.constructor?.name === 'Scene_Battle') {
      steps++
      if (typeof bm.isBattleEnd === 'function' && bm.isBattleEnd()) {
        if (typeof bm.update === 'function') bm.update()
        if (typeof scene.update === 'function') scene.update()
        continue
      }
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
      if (g.$gameMessage && typeof g.$gameMessage.isBusy === 'function' && g.$gameMessage.isBusy()) {
        g.$gameMessage.clear()
      }
      if (typeof bm.update === 'function') bm.update()
      if (typeof scene.update === 'function') scene.update()
    }

    // Post-battle safeguard: recover party HP
    if (party && typeof party.members === 'function') {
      for (const m of party.members()) {
        if (m && typeof m.recoverAll === 'function' && m.hp < m.mhp) {
          m.recoverAll()
        }
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

  private simulateKey(key: 'ok' | 'up' | 'down' | 'left' | 'right'): void {
    const g = globalThis as any
    const input = g.Input
    if (!input || !input._currentState) return
    input._currentState[key] = true
    setTimeout(() => {
      if (input._currentState) input._currentState[key] = false
    }, 100)
  }
}
