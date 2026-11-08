import { confirmWindowCommand, confirmWindowIndex, hpRatio, isHpRecovery } from './story-input'

let menuTaskActive = false

export function isStoryMenuActive(): boolean {
  return menuTaskActive
}

async function waitFor(check: () => boolean, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  return false
}

async function waitScene(name: string, signal?: AbortSignal): Promise<any> {
  const manager = (globalThis as any).SceneManager
  const ready = await waitFor(() => !manager._nextScene && manager._scene?.constructor?.name === name && manager._scene.isActive?.() !== false, signal)
  return ready ? manager._scene : null
}

async function openMenu(symbol: string, actorIndex: number, signal?: AbortSignal): Promise<any> {
  const engine = globalThis as any
  const scene = engine.SceneManager?._scene
  if (scene?.constructor?.name !== 'Scene_Map' || scene.isMenuEnabled?.() !== true || engine.$gamePlayer?.isMoving?.()) return null
  const input = engine.Input
  if (!input?._currentState) return null
  input._currentState.menu = true
  input._previousState ??= {}
  input._previousState.menu = false
  input._latestButton = 'menu'
  input._pressedTime = 0
  setTimeout(() => {
    input._currentState.menu = false
  }, 60)
  const menu = await waitScene('Scene_Menu', signal)
  if (!menu || !confirmWindowCommand(menu._commandWindow, symbol)) return null
  if (symbol === 'equip') {
    if (!(await waitFor(() => Boolean(menu._statusWindow?.active), signal)) || !confirmWindowIndex(menu._statusWindow, actorIndex)) return null
  }
  return waitScene(symbol === 'item' ? 'Scene_Item' : 'Scene_Equip', signal)
}

export async function popBackToMap(manager = (globalThis as any).SceneManager, _engine?: any, signal?: AbortSignal): Promise<void> {
  for (let step = 0; step < 12; step++) {
    signal?.throwIfAborted()
    if (!manager?._scene || manager._scene.constructor?.name === 'Scene_Map') return
    if (!(await waitFor(() => !manager._nextScene, signal))) return
    const scene = manager._scene
    if (!['Scene_Menu', 'Scene_Item', 'Scene_Equip'].includes(scene.constructor?.name)) return
    const window = [scene._actorWindow, scene._itemWindow, scene._slotWindow, scene._categoryWindow, scene._statusWindow, scene._commandWindow].find(
      (candidate) => candidate?.active && candidate?.isCancelEnabled?.()
    )
    if (typeof window?.processCancel !== 'function') return
    window.processCancel()
    if (!(await waitFor(() => manager._scene !== scene || !window.active, signal))) return
  }
}

async function withMenu(task: () => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  const engine = globalThis as any
  const scene = engine.SceneManager?._scene
  if (menuTaskActive || scene?.constructor?.name !== 'Scene_Map' || scene.isMenuEnabled?.() !== true) return false
  menuTaskActive = true
  try {
    return await task()
  } finally {
    try {
      if (!signal?.aborted) await popBackToMap(undefined, undefined, signal)
    } finally {
      menuTaskActive = false
    }
  }
}

export async function executeMapMenuUseItem(itemId: number, targetActorIndex = 0, signal?: AbortSignal): Promise<boolean> {
  return withMenu(async () => {
    const engine = globalThis as any
    const item = engine.$dataItems?.[itemId]
    const actor = engine.$gameParty?.members?.()[targetActorIndex]
    if (!item || !actor) return false
    const before = JSON.stringify([actor.hp, actor.mp, actor._states])
    const count = engine.$gameParty.numItems?.(item)
    const scene = await openMenu('item', targetActorIndex, signal)
    if (!scene || !(await waitFor(() => Boolean(scene._categoryWindow?.active), signal))) return false
    if (item.scope === 11 && scene.user?.() !== actor) return false
    if (!confirmWindowCommand(scene._categoryWindow, 'item')) return false
    if (!(await waitFor(() => Boolean(scene._itemWindow?.active), signal))) return false
    const index = scene._itemWindow._data?.indexOf(item) ?? -1
    if (!confirmWindowIndex(scene._itemWindow, index)) return false
    if ([7, 8, 9, 10, 11].includes(item.scope)) {
      if (!(await waitFor(() => Boolean(scene._actorWindow?.active), signal)) || !confirmWindowIndex(scene._actorWindow, targetActorIndex)) return false
    }
    return waitFor(() => before !== JSON.stringify([actor.hp, actor.mp, actor._states]) || (typeof count === 'number' && engine.$gameParty.numItems(item) < count), signal)
  }, signal)
}

export async function executeMapMenuEquip(slotId: number, itemId: number, isWeapon = true, actorIndex = 0, signal?: AbortSignal): Promise<boolean> {
  return withMenu(async () => {
    const engine = globalThis as any
    const item = (isWeapon ? engine.$dataWeapons : engine.$dataArmors)?.[itemId]
    const actor = engine.$gameParty?.members?.()[actorIndex]
    if (!item || !actor) return false
    const scene = await openMenu('equip', actorIndex, signal)
    if (!scene || !confirmWindowCommand(scene._commandWindow, 'equip')) return false
    if (!(await waitFor(() => Boolean(scene._slotWindow?.active), signal)) || !confirmWindowIndex(scene._slotWindow, slotId)) return false
    if (!(await waitFor(() => Boolean(scene._itemWindow?.active), signal))) return false
    if (!confirmWindowIndex(scene._itemWindow, scene._itemWindow._data?.indexOf(item) ?? -1)) return false
    return waitFor(() => actor.equips?.()[slotId] === item, signal)
  }, signal)
}

export async function tryMapMenuHealing(emit?: (summary: string) => void, signal?: AbortSignal): Promise<boolean> {
  const party = (globalThis as any).$gameParty
  const members = party?.members?.() ?? []
  const users = party?.movableMembers?.() ?? members.filter((actor: any) => actor.hp > 0)
  let menuUser = users[0]
  for (const user of users) {
    if ((user.pha ?? 0) > (menuUser?.pha ?? 0)) menuUser = user
  }
  const targets = members.filter((actor: any) => actor.hp > 0 && hpRatio(actor) < 0.75).sort((first: any, second: any) => hpRatio(first) - hpRatio(second))
  for (const actor of targets) {
    const items =
      party
        .items?.()
        .filter((candidate: any) => isHpRecovery(candidate) && party.numItems(candidate) > 0 && menuUser?.canUse?.(candidate) && (candidate.scope !== 11 || menuUser === actor)) ??
      []
    for (const item of items) {
      emit?.(`🎒 生命值偏低 (${actor.hp}/${actor.mhp})，打开游戏菜单选择【道具】使用【${item.name}】进行恢复…`)
      if (await executeMapMenuUseItem(item.id, members.indexOf(actor), signal)) return true
    }
  }
  return false
}
