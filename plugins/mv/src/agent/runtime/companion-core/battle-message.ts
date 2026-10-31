import type { ControlArbiter, ControlLease } from '@/lib/game-agent/companion/core/types'

import { readAgentGameState, runAgentCommand } from '../../handlers'
import { call, g, getBattleScene } from './battle-engine'

function pendingBattleMessage(): object | null {
  const scene = getBattleScene()
  const manager = g().BattleManager as { _phase?: string } | undefined
  const message = g().$gameMessage
  const window = scene?._messageWindow as { pause?: boolean; visible?: boolean; openness?: number } | undefined
  if (
    !scene ||
    call<boolean>(g().SceneManager, 'isGameActive') === false ||
    !['start', 'battleEnd'].includes(manager?._phase ?? '') ||
    call<boolean>(g().$gameTroop, 'isEventRunning') !== false ||
    call<boolean>(message, 'isBusy') !== true ||
    ['isChoice', 'isNumberInput', 'isItemChoice'].some((name) => call<boolean>(message, name) !== false) ||
    !window?.pause ||
    window.visible !== true ||
    window.openness !== 255 ||
    call<boolean>(window, 'isAnySubWindowActive') !== false
  )
    return null
  return window
}

/** Only acknowledge standard battle start/result narration, never event dialogue or choices. */
export function advanceBattleMessage(arbiter: ControlArbiter, lease: ControlLease): Promise<void> | null {
  const window = pendingBattleMessage()
  if (!window) return null
  const state = readAgentGameState()
  if (state.scene !== 'Scene_Battle' || !state.battle?.instanceId || !state.message?.busy) return null
  arbiter.assertCurrent(lease)
  return runAgentCommand(
    {
      id: 'companion-battle-message',
      method: 'input.press',
      params: {
        key: 'ok',
        frames: 3,
        guard: { controlToken: state.controlToken, battleInstanceId: state.battle.instanceId, allowedEffects: ['advance_dialogue'] },
      },
    },
    {
      inputOwner: lease.ownerId,
      control: { arbiter, lease },
      beforeInput: () => {
        arbiter.assertCurrent(lease)
        if (pendingBattleMessage() !== window) throw new Error('BATTLE_MESSAGE_CHANGED')
      },
    }
  ).then(() => undefined)
}
