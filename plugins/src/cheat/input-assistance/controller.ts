import { gameContentRelPath } from '@/lib/game/content-paths'
import { EMPTY_INPUT_ASSIST_CONFIG, type InputAssistConfig, type InputChord, type MacroEvent, mergeRules, parseInputAssistConfig, validateRule } from '@/lib/game/input-assistance'
import type { GameLinkMessage, InputAssistMessage } from '@/lib/runtime/game-link-protocol'

import { detectGameIdentity } from '../../helpers/game/game-identity'
import { gameRoomId } from '../../helpers/game/game-link'
import { tryNodeFsPath } from '../../helpers/node/node-require'
import { InputAssistanceRuntime } from './runtime'

type Send = (message: GameLinkMessage) => void
const GLOBAL_CACHE_KEY = 'chaya:input-assistance:global-snapshot'
const GAME_CACHE_KEY = 'chaya:input-assistance:game'

function diskFile(): { fs: typeof import('fs'); path: typeof import('path'); file: string } | null {
  const modules = tryNodeFsPath()
  const identity = detectGameIdentity()
  if (!modules || !identity) return null
  return { ...modules, file: modules.path.join(identity.contentRoot, gameContentRelPath('inputAssistance')) }
}

function readConfig(key: string, fromDisk = false): InputAssistConfig {
  try {
    const disk = fromDisk ? diskFile() : null
    const raw = disk ? disk.fs.readFileSync(disk.file, 'utf8') : localStorage.getItem(key)
    return raw ? parseInputAssistConfig(JSON.parse(raw)) : { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
  } catch {
    return { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
  }
}

function writeConfig(key: string, config: InputAssistConfig, toDisk = false): void {
  const disk = toDisk ? diskFile() : null
  if (disk) {
    disk.fs.mkdirSync(disk.path.dirname(disk.file), { recursive: true })
    disk.fs.writeFileSync(disk.file, JSON.stringify(config, null, 2))
  } else localStorage.setItem(key, JSON.stringify(config))
}

function checkedConfig(raw: unknown): InputAssistConfig {
  const parsed = parseInputAssistConfig(raw)
  const supplied = raw as { rules?: unknown[] } | null
  if (!supplied || !Array.isArray(supplied.rules) || parsed.rules.length !== supplied.rules.length) throw new Error('规则配置包含无效数据')
  for (const rule of parsed.rules) {
    const issues = validateRule(rule, false)
    if (issues.length) throw new Error(`${rule.name}: ${issues[0].message}`)
  }
  return parsed
}

export class InputAssistanceController {
  readonly runtime = new InputAssistanceRuntime()
  private globalConfig = readConfig(GLOBAL_CACHE_KEY)
  private gameConfig = readConfig(GAME_CACHE_KEY, true)
  private send: Send | null = null
  private unsubscribe: () => void
  private replies = new Map<string, InputAssistMessage>()

  constructor() {
    this.apply()
    this.unsubscribe = this.runtime.subscribe((status) => {
      ;(window as Window & { __chayaInputAssistanceStatus?: typeof status }).__chayaInputAssistanceStatus = status
      window.dispatchEvent(new CustomEvent('chaya:input-assistance-status', { detail: status }))
      this.send?.({ type: 'assist.status', status })
    })
  }

  dispose(): void {
    this.unsubscribe()
    this.runtime.dispose()
    this.send = null
    delete (window as Window & { __chayaInputAssistanceStatus?: unknown }).__chayaInputAssistanceStatus
  }

  private apply(): void {
    this.runtime.setConfig({
      version: 1,
      revision: Math.max(this.globalConfig.revision, this.gameConfig.revision),
      rules: mergeRules(this.globalConfig.rules, this.gameConfig.rules),
    })
  }

  /** Web 端经 GameLink 发来的命令；状态推送与配置变更都回到这条连接 */
  handle(message: GameLinkMessage, send: Send): boolean {
    if (message.type !== 'assist.cmd') return false
    this.send = send
    this.execute(message, send)
    return true
  }

  /** 局内浮层直接调用；不占用 GameLink 的回传通道，配置变更会同步给已连接的 Web 端 */
  request(message: GameLinkMessage, send: Send): void {
    if (message.type !== 'assist.cmd') return
    const changed = message.op === 'configure'
    this.execute(message, send)
    if (changed && this.send) this.send({ type: 'assist.config', globalConfig: this.globalConfig, gameConfig: this.gameConfig })
  }

  private execute(message: Extract<InputAssistMessage, { type: 'assist.cmd' }>, send: Send): void {
    const previous = this.replies.get(message.reqId)
    if (previous) {
      send(previous)
      return
    }
    let reply: InputAssistMessage
    try {
      if (message.gameId !== gameRoomId()) throw new Error('游戏连接已切换，请重新打开辅助页')
      let result: InputChord | MacroEvent[] | null | undefined
      switch (message.op) {
        case 'snapshot':
          break
        case 'configure': {
          const globalConfig = checkedConfig(message.globalConfig)
          const gameConfig = checkedConfig(message.gameConfig)
          if (globalConfig.revision < this.globalConfig.revision || gameConfig.revision < this.gameConfig.revision) throw new Error('配置版本过旧，请刷新后重试')
          writeConfig(GLOBAL_CACHE_KEY, globalConfig)
          writeConfig(GAME_CACHE_KEY, gameConfig, true)
          this.globalConfig = globalConfig
          this.gameConfig = gameConfig
          this.apply()
          break
        }
        case 'start': {
          if (this.runtime.snapshot().rules.find((rule) => rule.id === message.ruleId)?.kind === 'mapping') throw new Error('按键映射由触发键按住时执行')
          this.runtime.start(message.ruleId)
          break
        }
        case 'test':
          this.runtime.start(message.ruleId, true)
          break
        case 'stop':
          this.runtime.stop(message.ruleId)
          break
        case 'stopAll':
          this.runtime.stopAll()
          break
        case 'recordStart':
          void this.runtime.record(message.kind).then((recorded) => send({ type: 'assist.recorded', result: recorded }))
          break
        case 'recordFinish':
          result = this.runtime.finishRecording()
          break
        case 'recordCancel':
          this.runtime.cancelRecording()
          break
      }
      reply = { type: 'assist.reply', reqId: message.reqId, ok: true, globalConfig: this.globalConfig, gameConfig: this.gameConfig, status: this.runtime.status(), result }
    } catch (error) {
      reply = { type: 'assist.reply', reqId: message.reqId, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    this.replies.set(message.reqId, reply)
    if (this.replies.size > 200) this.replies.delete(this.replies.keys().next().value!)
    send(reply)
  }

  disconnected(): void {
    this.send = null
    this.runtime.cancelRecording()
  }
}
