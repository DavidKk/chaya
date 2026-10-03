import { RUN_ACTION_IDS, RUN_FLAG_KEYS } from '@/components/game-edit/types'
import type { WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { newEditCmdId } from '@/lib/runtime/game-edit-sync'
import type { GameEditAck, GameEditCmd, GameEditCmdOp, GameEditStateMsg, GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { EDIT_OPS, parseEditOp, parseRunAction } from '@/lib/webmcp/edit-ops'
import { functionToolDefinition, webMcpCodedError } from '@/lib/webmcp/mcp-mirror'

export const EDIT_REGISTRAR_ID = 'chaya.edit'

const STATE_TIMEOUT_MS = 5_000
const ACK_TIMEOUT_MS = 5_000
const RESEND_MS = 1_000

export type EditLinkDeps = {
  connected: () => boolean
  send: (msg: GameLinkMessage) => void
  subscribeMessages: (fn: (msg: GameLinkMessage) => void) => () => void
  acquireEditSession: () => () => void
}

function requireLink(link: EditLinkDeps) {
  if (!link.connected()) throw webMcpCodedError('game_offline', 'Game not connected: launch it from Chaya (on the web version, pick and open the game in the library first)')
}

/** Subscribe, then run `send` now and on every resend tick; a throwing `send` rejects and cleans up immediately. */
function waitForMessage<T extends GameLinkMessage>(link: EditLinkDeps, match: (msg: GameLinkMessage) => msg is T, timeoutMs: number, send?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let tick: number | undefined
    let settled = false
    const timer = window.setTimeout(() => {
      done()
      reject(webMcpCodedError('timeout', `The game did not respond within ${timeoutMs / 1000}s`))
    }, timeoutMs)
    const unsubscribe = link.subscribeMessages((msg) => {
      if (!match(msg)) return
      done()
      resolve(msg)
    })
    function done() {
      settled = true
      window.clearTimeout(timer)
      window.clearInterval(tick)
      unsubscribe()
    }
    if (!send) return
    const sendOrFail = () => {
      try {
        send()
      } catch (error) {
        done()
        reject(error)
      }
    }
    sendOrFail()
    if (!settled) tick = window.setInterval(sendOrFail, RESEND_MS)
  })
}

async function sendCmd(link: EditLinkDeps, op: GameEditCmdOp) {
  requireLink(link)
  const cmd = { type: 'edit.cmd', cmdId: newEditCmdId(), ...op } as GameEditCmd
  const acked = waitForMessage(
    link,
    (msg): msg is GameEditAck => msg.type === 'edit.ack' && msg.cmdId === cmd.cmdId,
    ACK_TIMEOUT_MS,
    () => link.send(cmd)
  )
  const ack = await acked
  return { applied: ack.ok, fields: ack.fields }
}

const EDIT_SET_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: EDIT_OPS, description: 'Edit operation' },
    value: { description: 'Target value: a number for gold / count / var / walkRate / runRate / expRate, a boolean for sw / runFlag' },
    on: { type: 'boolean', description: '*Lock: true to lock, false to unlock' },
    kind: { type: 'string', description: 'count / countLock: item / weapon / armor; actorVitalLock: level / exp / hp / mp; actorOwnedLock: skills / states' },
    id: { type: 'number', description: 'Item / variable / switch / actor id (look up with chaya_edit_catalog)' },
    key: { type: 'string', enum: RUN_FLAG_KEYS, description: 'runFlag flag name' },
    patch: { type: 'object', description: 'actor: fields to change, e.g. {"level":99,"hp":999}', properties: {} },
    actorId: { type: 'number', description: 'Actor id for actorVitalLock / actorOwnedLock' },
    entryId: { type: 'number', description: 'Skill / state id for actorOwnedLock' },
    owned: { type: 'boolean', description: 'actorOwnedLock: lock as owned / not owned' },
  },
  required: ['op'],
}

/** Live edit session over the game DataChannel — the same channel and ops as the edit page. */
export function buildEditTools(link: EditLinkDeps): WebMcpToolDefinition[] {
  return [
    functionToolDefinition(
      {
        name: 'chaya_web_edit_state',
        description:
          'Read the live in-game edit session: gold, item / weapon / armor counts, variables, switches, locks, actors, movement rates and run flags. Same source as the cheat page.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
      },
      async () => {
        requireLink(link)
        const release = link.acquireEditSession()
        try {
          const msg = await waitForMessage(link, (m): m is GameEditStateMsg => m.type === 'edit.state', STATE_TIMEOUT_MS)
          return { ready: msg.ready, ...(msg.error ? { error: msg.error } : {}), session: msg.session }
        } finally {
          release()
        }
      }
    ),
    functionToolDefinition(
      {
        name: 'chaya_web_edit_set',
        description:
          'Set or lock in-game values (same commands as the cheat page): gold, counts, variables, switches, locks, run flags, rates and actor stats. Returns after the game acknowledges.',
        inputSchema: EDIT_SET_SCHEMA,
      },
      async (args) => sendCmd(link, parseEditOp(args))
    ),
    functionToolDefinition(
      {
        name: 'chaya_web_edit_action',
        description: 'Run an action: open a scene (scene:*), fix a stuck state (fix:*), or control battle (battle:*).',
        inputSchema: { type: 'object', properties: { id: { type: 'string', enum: RUN_ACTION_IDS, description: 'Action id' } }, required: ['id'] },
      },
      async (args) => sendCmd(link, { op: 'runAction', id: parseRunAction(args) })
    ),
  ]
}
