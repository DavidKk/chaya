import { RGSS_SUPPORTED_RUN_ACTIONS, RGSS_SUPPORTED_RUN_FLAGS, runActionNeedsClose } from '@/components/game-edit/supported'
import { type FloatingBallRuntime, type FloatingBallSnapshot, floatingShortcutDisabledReason } from '@/components/game-tools/FloatingBall'
import { parseFloatingShortcut } from '@/lib/game-agent/floating-ball'
import type { MessageKey } from '@/lib/i18n'
import type { GameEditCmdOp, GameEditStateMsg } from '@/lib/runtime/game-link-protocol'

import { onGameMessage, postToGame, restoreGameFocus } from './host-bridge'

/** Use the normal state broadcast while idle; request a fresh snapshot only on execution. */
export function createRgssFloatingBallRuntime(onClose: () => void, text: (key: MessageKey) => string) {
  let snapshot: FloatingBallSnapshot = { ready: false, inBattle: false, flags: {} }
  let lastStateAt = 0
  let disposed = false
  const stateWaiters = new Set<(message: GameEditStateMsg) => void>()
  const rejectors = new Set<(error: Error) => void>()
  const commands = new Map<string, { acked: boolean; resolve: () => void; reject: (error: Error) => void }>()
  const unsubscribe = onGameMessage((message) => {
    if (message.type === 'edit.state') {
      snapshot = { ready: message.ready, inBattle: message.inBattle ?? !!message.battle, flags: message.session ?? {} }
      lastStateAt = Date.now()
      for (const waiter of [...stateWaiters]) waiter(message)
      for (const [id, command] of commands) {
        if (command.acked) {
          commands.delete(id)
          command.resolve()
        }
      }
    } else if (message.type === 'edit.ack') {
      const command = commands.get(message.cmdId)
      if (!command) return
      if (!message.ok) {
        commands.delete(message.cmdId)
        command.reject(new Error(message.error || text('floatingBall.failed')))
      } else command.acked = true
    }
  })

  function wait<T>(start: (resolve: (value: T) => void, reject: (error: Error) => void) => () => void): Promise<T> {
    return new Promise((resolve, reject) => {
      if (disposed) {
        reject(new Error(text('floatingBall.notReady')))
        return
      }
      let cleanup = () => {}
      const finish = (error?: Error, value?: T) => {
        clearTimeout(timer)
        cleanup()
        rejectors.delete(cancel)
        if (error) reject(error)
        else resolve(value as T)
      }
      const cancel = (error: Error) => finish(error)
      const timer = setTimeout(() => cancel(new Error(text('floatingBall.failed'))), 5000)
      rejectors.add(cancel)
      try {
        cleanup = start((value) => finish(undefined, value), cancel)
      } catch (error) {
        cancel(error instanceof Error ? error : new Error(text('floatingBall.failed')))
      }
    })
  }

  const supports: NonNullable<FloatingBallRuntime['supports']> = (id) => {
    const shortcut = parseFloatingShortcut(id)
    return shortcut?.kind === 'flag' ? RGSS_SUPPORTED_RUN_FLAGS.has(shortcut.target) : shortcut?.kind === 'action' && RGSS_SUPPORTED_RUN_ACTIONS.has(shortcut.target)
  }
  const runtime: FloatingBallRuntime = {
    supports,
    restoreFocus() {
      onClose()
      restoreGameFocus()
    },
    read: () => (Date.now() - lastStateAt > 3500 ? { ready: false, inBattle: false, flags: {} } : snapshot),
    async execute(id) {
      const shortcut = parseFloatingShortcut(id)
      if (!shortcut) return
      await wait<void>((resolve) => {
        const receive = () => {
          stateWaiters.delete(receive)
          resolve()
        }
        stateWaiters.add(receive)
        try {
          postToGame({ type: 'edit.subscribe' })
        } catch (error) {
          stateWaiters.delete(receive)
          throw error
        }
        return () => stateWaiters.delete(receive)
      })
      const reason = floatingShortcutDisabledReason(id, snapshot, supports(id))
      if (reason) throw new Error(text(reason))
      const op: GameEditCmdOp =
        shortcut.kind === 'flag' ? { op: 'runFlag', key: shortcut.target, value: !snapshot.flags[shortcut.target] } : { op: 'runAction', id: shortcut.target }
      if (shortcut.kind === 'action' && runActionNeedsClose(shortcut.target)) onClose()
      await wait<void>((resolve, reject) => {
        const cmdId = crypto.randomUUID()
        commands.set(cmdId, { acked: false, resolve: () => resolve(), reject })
        try {
          postToGame({ type: 'edit.cmd', cmdId, ...op })
        } catch (error) {
          commands.delete(cmdId)
          throw error
        }
        return () => commands.delete(cmdId)
      })
    },
  }
  try {
    postToGame({ type: 'edit.subscribe' })
  } catch {
    /* A missing host stays unavailable until the native bridge responds. */
  }
  return {
    runtime,
    dispose() {
      disposed = true
      unsubscribe()
      for (const reject of [...rejectors]) reject(new Error(text('floatingBall.notReady')))
      commands.clear()
      stateWaiters.clear()
    },
  }
}
