import type { ActionIntent, BattleFrame, ControlArbiter, ControlLease } from '@/lib/game-agent/companion/core/types'

import { runAgentCommand } from '../../handlers'
import { isPassiveSceneWindow } from '../../window-state'
import { bindBattleCommand } from './battle-command-binding'
import { call, g, getBattleScene, type Loose } from './battle-engine'
import type { BattleInputOption, BattleInputState, BattleNavigationPort } from './battle-navigator'

export function createBattleNavigationPort(arbiter: ControlArbiter, readFrame: () => BattleFrame | null, onConfirming: (commandId: string) => void): BattleNavigationPort {
  return {
    readFrame,
    onConfirming,
    bindAction(action: object, intent: ActionIntent, frame: BattleFrame) {
      bindBattleCommand(action, intent.commandId, frame.encounterId, frame.stamp, intent)
    },
    async readInput(): Promise<BattleInputState | null> {
      const state = (await runAgentCommand({ id: 'companion-observe', method: 'game.state', params: {} })) as {
        scene: string
        controlToken: string
        battle?: { instanceId?: string }
        message?: { busy?: boolean }
      }
      const scene = getBattleScene()
      if (
        !scene ||
        state.scene !== 'Scene_Battle' ||
        !state.battle?.instanceId ||
        state.message?.busy ||
        call<boolean>(g().$gameMessage, 'isBusy') ||
        call<boolean>(g().$gameTroop, 'isEventRunning') ||
        call<boolean>(scene, 'isBusy') ||
        call<boolean>(g().SceneManager, 'isGameActive') === false ||
        call<boolean>(g().BattleManager, 'isBusy')
      )
        return null
      const windows = Object.entries(scene).filter(([name, value]) => {
        const w = value as Loose | undefined
        return !isPassiveSceneWindow(name) && name.endsWith('Window') && w?.active && w.visible !== false && Number(w.openness ?? 255) > 0
      })
      if (windows.length !== 1) return null
      const [name, raw] = windows[0]
      const win = raw as Loose
      // MV activates command windows before their opening animation has finished.
      if (Number(win.openness ?? 255) !== 255 || call<boolean>(win, 'isOpenAndActive') === false) return null
      const kinds: Record<string, BattleInputState['kind']> = {
        _partyCommandWindow: 'party',
        _actorCommandWindow: 'command',
        _skillWindow: 'skill',
        _itemWindow: 'item',
        _enemyWindow: 'enemy',
        _actorWindow: 'ally',
      }
      const kind = kinds[name]
      if (!kind) return null
      const actor = call<Loose>(g().BattleManager, 'actor')
      let options: BattleInputOption[] = []
      if (kind === 'party' || kind === 'command') {
        options = ((win._list as Loose[] | undefined) || []).slice(0, 64).map((o, index) => ({
          index,
          enabled: o.enabled === true && (call<boolean>(win, 'isCommandEnabled', index) ?? true),
          symbol: String(o.symbol),
          ext: Number(o.ext),
        }))
      } else if (kind === 'skill' || kind === 'item') {
        options = ((win._data as Loose[] | undefined) || []).slice(0, 256).map((o, index) => ({
          index,
          abilityId: Number(o?.id),
          enabled: !!o && !!call<boolean>(actor, 'canUse', o) && (call<boolean>(win, 'isEnabled', o) ?? false),
        }))
      } else {
        const action = call<Loose>(g().BattleManager, 'inputtingAction')
        const isForDead = Boolean(action && typeof action.isForDeadFriend === 'function' ? action.isForDeadFriend() : false)
        const members = kind === 'enemy' ? (win._enemies as Loose[] | undefined) : call<Loose[]>(g().$gameParty, 'battleMembers')
        options = (members || []).slice(0, 16).map((member, index) => {
          const isDead = Boolean(call<boolean>(member, 'isDead'))
          return {
            index,
            enabled: kind === 'enemy' ? !isDead : isForDead ? isDead : !isDead,
            entityId: call<number>(member, kind === 'enemy' ? 'enemyId' : 'actorId'),
            instanceId: kind === 'enemy' ? `enemy:${call<number>(member, 'index') ?? index}` : undefined,
          }
        })
      }
      const index = call<number>(win, 'index') ?? Number(win._index)
      const maxCols = call<number>(win, 'maxCols') ?? 1
      if (!Number.isInteger(index) || index < 0 || !Number.isInteger(maxCols) || maxCols < 1) return null
      return {
        controlToken: state.controlToken,
        battleInstanceId: state.battle.instanceId,
        kind,
        index,
        maxCols,
        options,
        action: call<object>(g().BattleManager, 'inputtingAction'),
      }
    },
    async press(key, input, lease: ControlLease, beforeDispatch) {
      arbiter.assertCurrent(lease)
      await runAgentCommand(
        {
          id: 'companion-input',
          method: 'input.press',
          params: {
            key,
            frames: 3,
            guard: { controlToken: input.controlToken, battleInstanceId: input.battleInstanceId, allowedEffects: ['navigate', 'battle_command', 'spend_resource'] },
          },
        },
        {
          inputOwner: lease.ownerId,
          control: { arbiter, lease },
          beforeInput: () => {
            arbiter.assertCurrent(lease)
            beforeDispatch?.()
          },
        }
      )
    },
  }
}
