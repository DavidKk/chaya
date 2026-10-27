import type { ActionIntent, BattleFrame, ControlArbiter, ControlLease } from '@/lib/game-agent/companion/core/types'
import type { AgentInputKey } from '@/lib/runtime/agent-protocol'

export type BattleInputOption = { index: number; enabled: boolean; symbol?: string; ext?: number; abilityId?: number; entityId?: number; instanceId?: string }
export type BattleInputState = {
  controlToken: string
  battleInstanceId: string
  kind: 'party' | 'command' | 'skill' | 'enemy' | 'ally'
  index: number
  maxCols: number
  options: BattleInputOption[]
  action?: object
}
export type BattleNavigationPort = {
  readFrame(): BattleFrame | null
  readInput(): Promise<BattleInputState | null>
  press(key: AgentInputKey, input: BattleInputState, lease: ControlLease): Promise<void>
  bindAction(action: object, intent: ActionIntent, frame: BattleFrame): void
  onConfirming(commandId: string): void
}
export type ExecutionResult = { ok: true; committed: boolean } | { ok: false; reason: string; unknown?: boolean }
const context = (f: BattleFrame) => JSON.stringify([f.stamp.scope, f.stamp.contextEpoch, f.encounterId])

function desiredOption(input: BattleInputState, intent: ActionIntent): BattleInputOption | undefined {
  if (input.kind === 'party' && intent.actionOffer.actionKey === 'party:fight') return input.options.find((o) => o.symbol === 'fight')
  if (input.kind === 'command') return input.options.find((o) => o.symbol === intent.actionOffer.kind && (o.symbol !== 'skill' || o.ext === intent.actionOffer.skillTypeId))
  if (input.kind === 'skill') return input.options.find((o) => o.abilityId === intent.actionOffer.abilityId)
  if (input.kind === 'enemy' && intent.target.kind === 'enemy') return input.options.find((o) => o.entityId === intent.target.entityId && o.instanceId === intent.target.instanceId)
  if (input.kind === 'ally' && intent.target.kind === 'actor') return input.options.find((o) => o.entityId === intent.target.entityId)
  return undefined
}

export class BattleNavigator {
  constructor(
    private readonly arbiter: ControlArbiter,
    private readonly port: BattleNavigationPort
  ) {}

  async execute(intent: ActionIntent, lease: ControlLease): Promise<ExecutionResult> {
    const initial = this.port.readFrame()
    if (!initial || initial.opportunity?.opportunityId !== intent.opportunityId) return { ok: false, reason: 'STALE_OPPORTUNITY' }
    const initialContext = context(initial)
    let sent = false
    let lastConfirm = ''
    const deadline = Date.now() + 8000
    try {
      for (let step = 0; step < 96 && Date.now() < deadline; step += 1) {
        this.arbiter.assertCurrent(lease)
        const frame = this.port.readFrame()
        if (!frame || context(frame) !== initialContext) return { ok: false, reason: 'CONTEXT_CHANGED', unknown: sent }
        if (frame.opportunity?.opportunityId !== intent.opportunityId) {
          if (sent && (frame.phase === 'resolving' || frame.phase === 'result' || frame.opportunity)) return { ok: true, committed: true }
          return { ok: false, reason: 'OPPORTUNITY_CHANGED', unknown: sent }
        }
        const input = await this.port.readInput()
        this.arbiter.assertCurrent(lease)
        if (!input) return { ok: false, reason: 'INPUT_BLOCKED', unknown: sent }
        const fresh = this.port.readFrame()
        if (!fresh || context(fresh) !== initialContext || fresh.opportunity?.opportunityId !== intent.opportunityId) {
          return { ok: false, reason: 'STATE_CHANGED', unknown: sent }
        }
        const desired = desiredOption(input, intent)
        if (!desired?.enabled) return { ok: false, reason: 'UNSUPPORTED_OR_DISABLED_MENU', unknown: sent }
        const fingerprint = JSON.stringify([input.kind, input.index, input.options])
        // A successful key dispatch without a menu/slot transition is never replayed.
        if (lastConfirm === fingerprint) return { ok: false, reason: 'COMMITMENT_UNCONFIRMED', unknown: true }
        let key: AgentInputKey
        if (input.index !== desired.index) {
          const row = Math.floor(desired.index / input.maxCols) - Math.floor(input.index / input.maxCols)
          key = row ? (row > 0 ? 'down' : 'up') : desired.index > input.index ? 'right' : 'left'
        } else {
          key = 'ok'
          const finalSelection =
            input.kind === 'enemy' || input.kind === 'ally' || ((input.kind === 'command' || input.kind === 'skill') && !['enemy', 'actor'].includes(intent.target.kind))
          if (input.action && finalSelection) this.port.bindAction(input.action, intent, fresh)
          this.port.onConfirming(intent.commandId)
          lastConfirm = fingerprint
          // Set before the async call: a failure can occur after the engine accepted input.
          sent = true
        }
        this.arbiter.assertCurrent(lease)
        await this.port.press(key, input, lease)
      }
      return { ok: false, reason: 'NAVIGATION_LIMIT', unknown: sent }
    } catch (err) {
      return { ok: false, reason: (err as Error).message, unknown: sent }
    }
  }
}
