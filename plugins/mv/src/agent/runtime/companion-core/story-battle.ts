import { confirmWindowCommand, confirmWindowIndex, hpRatio, isHpRecovery } from './story-input'

export class StoryBattleDriver {
  private plannedItem: any = null
  private targetActor: any = null
  private actionOwner: any = null
  private action: any = null
  private rejected = new Set<any>()

  constructor(
    private readonly emit: (summary: string) => void,
    private readonly press: () => void
  ) {}

  public step(scene: any): void {
    const engine = globalThis as any
    const manager = engine.BattleManager
    if (!manager || engine.SceneManager?._nextScene) return
    if (manager.isBattleEnd?.() || manager._phase === 'battleEnd') {
      this.emit('战斗结算确认中：等待游戏完成奖励与场景切换…')
      if (scene._messageWindow?.pause && !scene._messageWindow.isAnySubWindowActive?.()) this.press()
      return
    }
    const members = engine.$gameParty?.battleMembers?.() ?? engine.$gameParty?.members?.() ?? []
    const wounded = members.filter((actor: any) => actor.hp > 0 && hpRatio(actor) <= 0.65).sort((first: any, second: any) => hpRatio(first) - hpRatio(second))[0]
    if (scene._partyCommandWindow?.active) {
      const canHeal = members.some(
        (actor: any) =>
          this.findHealingItem(engine.$gameParty, actor, wounded) || actor.usableSkills?.().some((skill: any) => isHpRecovery(skill) && (skill.scope !== 11 || actor === wounded))
      )
      if (wounded && hpRatio(wounded) < 0.35 && !canHeal && confirmWindowCommand(scene._partyCommandWindow, 'escape')) {
        this.emit(`🚨 生命危急 (${wounded.hp}/${wounded.mhp}) 且无治疗道具，选择菜单【撤退】。`)
        return
      }
      confirmWindowCommand(scene._partyCommandWindow, 'fight')
      return
    }
    if (scene._enemyWindow?.active) {
      const enemies = scene._enemyWindow._enemies ?? []
      const index = enemies.reduce((best: number, enemy: any, current: number) => (enemy?.isAlive?.() !== false && (best < 0 || enemy.hp < enemies[best].hp) ? current : best), -1)
      confirmWindowIndex(scene._enemyWindow, index)
      return
    }
    if (scene._actorWindow?.active) {
      const index = members.indexOf(this.targetActor)
      if (index >= 0) confirmWindowIndex(scene._actorWindow, index)
      else scene._actorWindow.processCancel?.()
      return
    }
    for (const window of [scene._itemWindow, scene._skillWindow]) {
      if (!window?.active) continue
      if (!this.plannedItem || !confirmWindowIndex(window, window._data?.indexOf(this.plannedItem) ?? -1)) {
        if (this.plannedItem) this.rejected.add(this.plannedItem)
        window.processCancel?.()
      }
      return
    }
    const window = scene._actorCommandWindow
    const actor = manager.actor?.()
    if (!window?.active || !actor) return
    const action = manager.inputtingAction?.()
    if (this.actionOwner !== actor || this.action !== action) {
      this.rejected.clear()
      this.actionOwner = actor
      this.action = action
    }
    this.plannedItem = null
    this.targetActor = null
    if (wounded) {
      const item = this.findHealingItem(engine.$gameParty, actor, wounded)
      const skill = actor.usableSkills?.().find((candidate: any) => !this.rejected.has(candidate) && isHpRecovery(candidate) && (candidate.scope !== 11 || actor === wounded))
      if (item || skill) {
        this.plannedItem = item ?? skill
        this.targetActor = this.plannedItem.scope === 11 ? actor : wounded
        if (item ? confirmWindowCommand(window, 'item') : confirmWindowCommand(window, 'skill', skill.stypeId)) {
          this.emit(`🧪 治疗 ${this.targetActor.name?.() ?? '队友'} (${this.targetActor.hp}/${this.targetActor.mhp})：菜单选择【${this.plannedItem.name}】。`)
          return
        }
      }
    }
    if (hpRatio(actor) < 0.35 && confirmWindowCommand(window, 'guard')) {
      this.emit(`🛡️ 生命危急 (${actor.hp}/${actor.mhp})，菜单选择【防御】。`)
      return
    }
    const skill = actor
      .usableSkills?.()
      .find(
        (candidate: any) =>
          !this.rejected.has(candidate) && candidate.id !== actor.attackSkillId?.() && [1, 2, 3, 4, 5, 6].includes(candidate.scope) && [1, 5].includes(candidate.damage?.type)
      )
    if (skill && confirmWindowCommand(window, 'skill', skill.stypeId)) {
      this.plannedItem = skill
      this.emit(`⚡ 菜单选择战技【${skill.name}】。`)
      return
    }
    if (confirmWindowCommand(window, 'attack')) this.emit(`⚔️ 菜单选择【攻击】 (HP: ${actor.hp}/${actor.mhp})。`)
  }

  private findHealingItem(party: any, actor: any, target: any): any {
    return party
      ?.items?.()
      .find((item: any) => !this.rejected.has(item) && isHpRecovery(item) && (item.scope !== 11 || actor === target) && actor.canUse?.(item) && party.numItems(item) > 0)
  }
}
