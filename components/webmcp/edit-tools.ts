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
  if (!link.connected()) throw webMcpCodedError('game_offline', '游戏未连接：请从 Chaya 启动游戏（网页版先在游戏库选择游戏并打开）')
}

function waitForMessage<T extends GameLinkMessage>(link: EditLinkDeps, match: (msg: GameLinkMessage) => msg is T, timeoutMs: number, onTick?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tick = onTick ? window.setInterval(onTick, RESEND_MS) : undefined
    const timer = window.setTimeout(() => {
      done()
      reject(webMcpCodedError('timeout', `游戏 ${timeoutMs / 1000} 秒内未响应`))
    }, timeoutMs)
    const unsubscribe = link.subscribeMessages((msg) => {
      if (!match(msg)) return
      done()
      resolve(msg)
    })
    function done() {
      window.clearTimeout(timer)
      window.clearInterval(tick)
      unsubscribe()
    }
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
  link.send(cmd)
  const ack = await acked
  return { applied: ack.ok, fields: ack.fields }
}

const EDIT_SET_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: EDIT_OPS, description: '改值类型' },
    value: { description: '目标值：gold / count / var / walkRate / runRate / expRate 为数字，sw / runFlag 为布尔' },
    on: { type: 'boolean', description: '*Lock：true 锁定、false 解锁' },
    kind: { type: 'string', description: 'count / countLock：item / weapon / armor；actorVitalLock：level / exp / hp / mp；actorOwnedLock：skills / states' },
    id: { type: 'number', description: '物品 / 变量 / 开关 / 角色 id（用 chaya_edit_catalog 查）' },
    key: { type: 'string', enum: RUN_FLAG_KEYS, description: 'runFlag 的开关名' },
    patch: { type: 'object', description: 'actor：要改的字段，如 {"level":99,"hp":999}', properties: {} },
    actorId: { type: 'number', description: 'actorVitalLock / actorOwnedLock 的角色 id' },
    entryId: { type: 'number', description: 'actorOwnedLock 的技能 / 状态 id' },
    owned: { type: 'boolean', description: 'actorOwnedLock：锁定为拥有 / 不拥有' },
  },
  required: ['op'],
}

/** Live edit session over the game DataChannel — the same channel and ops as the edit page. */
export function buildEditTools(link: EditLinkDeps): WebMcpToolDefinition[] {
  return [
    functionToolDefinition(
      {
        name: 'chaya_web_edit_state',
        description: '读取局内实时修改会话：金钱、物品 / 武器 / 防具持有数、变量、开关、锁定、角色、移动倍率、运行开关。与修改页同一数据源。',
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
        description: '局内改值 / 锁定（与修改页相同的指令）：金钱、持有数、变量、开关、锁定、运行开关、倍率、角色属性。等游戏确认后返回。',
        inputSchema: EDIT_SET_SCHEMA,
      },
      async (args) => sendCmd(link, parseEditOp(args))
    ),
    functionToolDefinition(
      {
        name: 'chaya_web_edit_action',
        description: '执行运行动作：打开场景（scene:*）、修复卡住（fix:*）、战斗控制（battle:*）。',
        inputSchema: { type: 'object', properties: { id: { type: 'string', enum: RUN_ACTION_IDS, description: '动作 id' } }, required: ['id'] },
      },
      async (args) => sendCmd(link, { op: 'runAction', id: parseRunAction(args) })
    ),
  ]
}
