/**
 * Start an event list at any command: the map interpreter runs from there and continues normally.
 */
import { gameMap } from '../runtime/game-globals'

type Command = { code: number; indent: number; parameters: unknown[] }
type Interpreter = {
  isRunning?: () => boolean
  setup?: (list: Command[], eventId?: number) => void
  _index: number
  _branch: Record<number, unknown>
}

const g = () =>
  globalThis as {
    $dataCommonEvents?: ({ list?: Command[] } | null)[]
    $dataMap?: { events?: ({ pages?: { list?: Command[] }[] } | null)[] } | null
  }

/**
 * Branch values for every branch enclosing `from` (and `from` itself), so the interpreter enters
 * them and skips their siblings: choice 402 / cancel 403, else 411, battle win / escape / lose 601–603.
 */
export function enclosingBranches(list: readonly Command[], from: number): Record<number, unknown> {
  const out: Record<number, unknown> = {}
  let indent = (list[from]?.indent ?? 0) + 1
  for (let i = from; i >= 0 && indent > 0; i--) {
    const cmd = list[i]
    if (cmd.indent >= indent) continue
    indent = cmd.indent
    if (cmd.code === 402) out[indent] = cmd.parameters[0]
    else if (cmd.code === 403) out[indent] = -2
    else if (cmd.code === 411) out[indent] = false
    else if (cmd.code >= 601 && cmd.code <= 603) out[indent] = cmd.code - 601
  }
  return out
}

const mapInterpreter = () => gameMap()?._interpreter as Interpreter | undefined

/** Every run path rejects while the map interpreter is busy instead of queueing silently */
export function assertIdle() {
  if (mapInterpreter()?.isRunning?.()) throw new Error('有事件正在执行，请等它结束再试')
}

function startAt(list: Command[] | undefined, from: number, eventId: number) {
  if (!list?.length) throw new Error('事件内容为空')
  const at = Math.floor(from)
  if (!(at >= 0 && at < list.length)) throw new Error(`指令位置无效：${from}`)
  const interpreter = mapInterpreter()
  if (!interpreter || typeof interpreter.setup !== 'function') throw new Error('游戏未就绪，或该游戏不支持从指定行执行')
  assertIdle()
  interpreter.setup(list, eventId)
  interpreter._index = at
  Object.assign(interpreter._branch, enclosingBranches(list, at))
}

export function startCommonEventAt(id: number, from: number) {
  startAt(g().$dataCommonEvents?.[Math.floor(id)]?.list, from, 0)
}

export function startMapEventAt(eventId: number, page: number, from: number) {
  const pages = g().$dataMap?.events?.[Math.floor(eventId)]?.pages
  if (!pages?.[page]) throw new Error(`事件 ${eventId} 没有第 ${page + 1} 页`)
  startAt(pages[page].list, from, Math.floor(eventId))
}
