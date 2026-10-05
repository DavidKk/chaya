import type { EventCommand, EventNames } from './types'

/** 对应 i18n `events.cmd.<key>` */
export type ScriptKey =
  | 'text'
  | 'scroll'
  | 'choices'
  | 'when'
  | 'whenCancel'
  | 'ifSwitchOn'
  | 'ifSwitchOff'
  | 'ifVariable'
  | 'ifSelfOn'
  | 'ifSelfOff'
  | 'ifGold'
  | 'ifItem'
  | 'ifScript'
  | 'ifOther'
  | 'else'
  | 'loop'
  | 'breakLoop'
  | 'exitEvent'
  | 'commonEvent'
  | 'label'
  | 'jump'
  | 'switchOn'
  | 'switchOff'
  | 'variable'
  | 'selfOn'
  | 'selfOff'
  | 'timerStart'
  | 'timerStop'
  | 'gold'
  | 'item'
  | 'weapon'
  | 'armor'
  | 'partyAdd'
  | 'partyRemove'
  | 'transfer'
  | 'transferVar'
  | 'battle'
  | 'shop'
  | 'nameInput'
  | 'changeName'
  | 'wait'
  | 'showPicture'
  | 'erasePicture'
  | 'fadeout'
  | 'fadein'
  | 'bgm'
  | 'se'
  | 'menu'
  | 'save'
  | 'gameOver'
  | 'title'
  | 'script'
  | 'plugin'
  | 'comment'
  | 'other'

/** 着色：对话 / 流程 / 改数据 / 高风险 / 注释 */
export type ScriptTone = 'text' | 'flow' | 'effect' | 'risk' | 'muted'

export type ScriptLine = {
  indent: number
  key: ScriptKey
  tone: ScriptTone
  args?: Record<string, string | number>
  /** 对话 / 脚本正文（有译文时为译文） */
  body?: string
  /** 正文原文；与 body 相同时省略 */
  source?: string
  link?: { kind: 'common' | 'map'; id: number }
}

const num = (value: unknown) => Math.floor(Number(value) || 0)
const PARAMS_PREVIEW = 120

function paramsPreview(params: readonly unknown[]): string {
  let raw: string
  try {
    raw = JSON.stringify(params) ?? ''
  } catch {
    raw = ''
  }
  return raw.length > PARAMS_PREVIEW ? `${raw.slice(0, PARAMS_PREVIEW)}…` : raw
}
const str = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value))

export function labelOf(list: readonly string[], id: number): string {
  const name = list[id]
  return name ? `#${id} ${name}` : `#${id}`
}

function rangeLabel(list: readonly string[], start: unknown, end: unknown): string {
  const from = num(start)
  const to = num(end)
  return to > from ? `#${from}–#${to}` : labelOf(list, from)
}

const VAR_OPS = ['=', '+=', '-=', '*=', '/=', '%='] as const
const COMPARE_OPS = ['=', '≥', '≤', '>', '<', '≠'] as const
const GOLD_COMPARE = ['≥', '≤', '<'] as const

function signed(op: unknown, value: string): string {
  return num(op) === 1 ? `-${value}` : `+${value}`
}

function operandValue(names: EventNames, type: unknown, value: unknown): string {
  return num(type) === 1 ? `V[${labelOf(names.variables, num(value))}]` : String(num(value))
}

function variableOperand(names: EventNames, p: readonly unknown[]): string {
  switch (num(p[3])) {
    case 0:
      return String(num(p[4]))
    case 1:
      return `V[${labelOf(names.variables, num(p[4]))}]`
    case 2:
      return `rand(${num(p[4])}..${num(p[5])})`
    case 4:
      return str(p[4])
    default:
      return '…'
  }
}

function conditionLine(names: EventNames, p: readonly unknown[]): Pick<ScriptLine, 'key' | 'args'> {
  switch (num(p[0])) {
    case 0:
      return { key: num(p[2]) === 0 ? 'ifSwitchOn' : 'ifSwitchOff', args: { target: labelOf(names.switches, num(p[1])) } }
    case 1:
      return {
        key: 'ifVariable',
        args: { target: labelOf(names.variables, num(p[1])), op: COMPARE_OPS[num(p[4])] ?? '?', value: operandValue(names, p[2], p[3]) },
      }
    case 2:
      return { key: num(p[2]) === 0 ? 'ifSelfOn' : 'ifSelfOff', args: { ch: str(p[1]) } }
    case 7:
      return { key: 'ifGold', args: { op: GOLD_COMPARE[num(p[2])] ?? '?', value: num(p[1]) } }
    case 8:
      return { key: 'ifItem', args: { target: labelOf(names.items, num(p[1])) } }
    case 12:
      return { key: 'ifScript', args: { script: str(p[1]) } }
    default:
      return { key: 'ifOther', args: { type: num(p[0]) } }
  }
}

/** 指令码后跟的续行（401 对话、405 滚动文字、408 注释、655 脚本） */
const CONTINUATION: Record<number, number> = { 101: 401, 105: 405, 108: 408, 355: 655 }
const SKIP = new Set([0, 404, 412, 413, 604])

/** 指令列表 → 可读剧本；未知指令保留指令码，不报错 */
export function interpretCommands(list: readonly EventCommand[], names: EventNames, texts: Readonly<Record<string, string>> = {}): ScriptLine[] {
  const tr = (text: string) => texts[text] ?? text
  const out: ScriptLine[] = []
  for (let i = 0; i < list.length; i++) {
    const cmd = list[i]
    const p = cmd.parameters
    if (SKIP.has(cmd.code)) continue
    const line = (key: ScriptKey, tone: ScriptTone, args?: ScriptLine['args'], extra?: Partial<ScriptLine>) =>
      out.push({ indent: cmd.indent, key, tone, ...(args ? { args } : {}), ...extra })

    const follow = CONTINUATION[cmd.code]
    if (follow) {
      const lines: string[] = cmd.code === 108 || cmd.code === 355 ? [str(p[0])] : []
      while (list[i + 1]?.code === follow) lines.push(str(list[++i].parameters[0]))
      const source = lines.join('\n')
      const body = cmd.code === 101 || cmd.code === 105 ? lines.map(tr).join('\n') : source
      const extra = { body, ...(body !== source ? { source } : {}) }
      if (cmd.code === 101) line('text', 'text', { speaker: tr(str(p[4])) }, extra)
      else if (cmd.code === 105) line('scroll', 'text', undefined, extra)
      else if (cmd.code === 108) line('comment', 'muted', undefined, extra)
      else line('script', 'risk', undefined, extra)
      continue
    }

    switch (cmd.code) {
      case 102:
        line('choices', 'flow', { choices: (Array.isArray(p[0]) ? p[0] : []).map((c) => tr(str(c))).join(' / ') })
        break
      case 402:
        line('when', 'flow', { choice: tr(str(p[1])) })
        break
      case 403:
        line('whenCancel', 'flow')
        break
      case 111: {
        const cond = conditionLine(names, p)
        line(cond.key, 'flow', cond.args)
        break
      }
      case 411:
        line('else', 'flow')
        break
      case 112:
        line('loop', 'flow')
        break
      case 113:
        line('breakLoop', 'flow')
        break
      case 115:
        line('exitEvent', 'flow')
        break
      case 117:
        line('commonEvent', 'flow', { target: labelOf(names.commonEvents, num(p[0])) }, { link: { kind: 'common', id: num(p[0]) } })
        break
      case 118:
        line('label', 'muted', { name: str(p[0]) })
        break
      case 119:
        line('jump', 'flow', { name: str(p[0]) })
        break
      case 121:
        line(num(p[2]) === 0 ? 'switchOn' : 'switchOff', 'effect', { target: rangeLabel(names.switches, p[0], p[1]) })
        break
      case 122:
        line('variable', 'effect', { target: rangeLabel(names.variables, p[0], p[1]), op: VAR_OPS[num(p[2])] ?? '=', value: variableOperand(names, p) })
        break
      case 123:
        line(num(p[1]) === 0 ? 'selfOn' : 'selfOff', 'effect', { ch: str(p[0]) })
        break
      case 124:
        if (num(p[0]) === 0) line('timerStart', 'effect', { sec: num(p[1]) })
        else line('timerStop', 'effect')
        break
      case 125:
        line('gold', 'effect', { amount: signed(p[0], operandValue(names, p[1], p[2])) })
        break
      case 126:
      case 127:
      case 128: {
        const key = cmd.code === 126 ? 'item' : cmd.code === 127 ? 'weapon' : 'armor'
        const db = cmd.code === 126 ? names.items : cmd.code === 127 ? names.weapons : names.armors
        line(key, 'effect', { target: labelOf(db, num(p[0])), amount: signed(p[1], operandValue(names, p[2], p[3])) })
        break
      }
      case 129:
        line(num(p[1]) === 0 ? 'partyAdd' : 'partyRemove', 'effect', { target: labelOf(names.actors, num(p[0])) })
        break
      case 201:
        if (num(p[0]) === 0) line('transfer', 'risk', { target: labelOf(names.maps, num(p[1])), x: num(p[2]), y: num(p[3]) }, { link: { kind: 'map', id: num(p[1]) } })
        else line('transferVar', 'risk')
        break
      case 301:
        line('battle', 'risk', { target: num(p[0]) === 0 ? labelOf(names.troops, num(p[1])) : '…' })
        break
      case 302:
        line('shop', 'effect')
        break
      case 303:
        line('nameInput', 'effect', { target: labelOf(names.actors, num(p[0])) })
        break
      case 320:
        line('changeName', 'effect', { target: labelOf(names.actors, num(p[0])), value: str(p[1]) })
        break
      case 230:
        line('wait', 'muted', { frames: num(p[0]) })
        break
      case 231:
        line('showPicture', 'muted', { id: num(p[0]), name: str(p[1]) })
        break
      case 235:
        line('erasePicture', 'muted', { id: num(p[0]) })
        break
      case 221:
        line('fadeout', 'muted')
        break
      case 222:
        line('fadein', 'muted')
        break
      case 241:
        line('bgm', 'muted', { name: str((p[0] as { name?: unknown } | null)?.name) })
        break
      case 250:
        line('se', 'muted', { name: str((p[0] as { name?: unknown } | null)?.name) })
        break
      case 351:
        line('menu', 'flow')
        break
      case 352:
        line('save', 'risk')
        break
      case 353:
        line('gameOver', 'risk')
        break
      case 354:
        line('title', 'risk')
        break
      case 356:
        line('plugin', 'risk', undefined, { body: str(p[0]) })
        break
      case 357:
        line('plugin', 'risk', undefined, { body: [str(p[0]), str(p[1])].filter(Boolean).join(' · ') })
        break
      default:
        if (cmd.code >= 400) break
        line('other', 'muted', { code: cmd.code, params: paramsPreview(p) })
    }
  }
  return out
}
