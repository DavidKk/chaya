/** Minimal MV action contract: recovery formulas produce negative damage. */
export function installActionFixture(skills: any[], items: any[] = [], attackDamage = 20) {
  class Action {
    _actionType = 'none'
    _skillId = 0
    _itemId = 0
    _targetIndex = -1
    setAttack() {
      this._actionType = 'attack'
    }
    setGuard() {
      this._actionType = 'guard'
    }
    setSkill(id: number) {
      this._actionType = 'skill'
      this._skillId = id
    }
    setItem(id: number) {
      this._actionType = 'item'
      this._itemId = id
    }
    setTarget(index: number) {
      this._targetIndex = index
    }
    item() {
      if (this._actionType === 'skill') return skills.find((skill) => skill.id === this._skillId)
      if (this._actionType === 'item') return items.find((item) => item.id === this._itemId)
      return null
    }
    isSkill() {
      return this._actionType === 'skill'
    }
    isItem() {
      return this._actionType === 'item'
    }
    makeDamageValue(target: any) {
      if (this._actionType === 'attack') return attackDamage
      const damage = this.item()?.damage
      const value = Number(damage?.formula ?? 0)
      if (!Number.isFinite(value)) throw new Error('formula requires execution context')
      const sign = [3, 4].includes(damage?.type) ? -1 : 1
      return sign * value * (target.damageRate ?? 1)
    }
  }
  Object.assign(globalThis, { Game_Action: Action })
}
