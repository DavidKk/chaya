import type { AgentRoutine } from '@/lib/game-agent/runtime'

type GameEvent = { _erased?: boolean; _pageIndex?: number; _direction?: number; _characterName?: string; isStarting?: () => boolean }
type RmGlobals = {
  SceneManager?: { _scene?: unknown }
  Scene_Map?: new () => unknown
  Scene_Battle?: new () => unknown
  Scene_Gameover?: new () => unknown
  Scene_MenuBase?: new () => unknown
  $gameMap?: {
    mapId: () => number
    event?: (id: number) => GameEvent | undefined
    isEventRunning?: () => boolean
    _interpreter?: { eventId?: () => number; _eventId?: number }
  }
  $gamePlayer?: { x: number; y: number; isMoving: () => boolean; setDirection?: (direction: number) => void }
  $gameMessage?: { isBusy?: () => boolean }
  $gameTemp?: { _destinationX: number | null; _destinationY: number | null; isDestinationValid: () => boolean }
}

export type ChestRoutineIo = {
  signal: AbortSignal
  locale?: string
  press: (key: 'ok' | 'cancel') => Promise<unknown>
  report: (summary: string) => void
}

const TICK_MS = 120
const STUCK_MS = 15_000
const MAX_OPEN_TRIES = 5

const COPY = {
  zh: {
    marked: (x: number, y: number) => `已标记宝箱位置（${x}, ${y}），正在过去`,
    battle: '遇到战斗，自动战斗中，结束后继续去拿宝箱',
    dialogue: '出现对话，自动推进后继续前进',
    resume: '继续前往宝箱',
    opening: '到了，正在打开宝箱',
    done: '宝箱拿到啦！',
    gone: '宝箱已经不在了，托管结束',
    offMap: '已离开宝箱所在的地图，托管结束',
    noPath: '找不到通往宝箱的路，托管结束',
    locked: '宝箱打不开，托管结束',
    alreadyOpened: '这个宝箱已经打开了，托管结束',
    gameover: '队伍全灭，托管结束',
  },
  en: {
    marked: (x: number, y: number) => `Marked the chest at (${x}, ${y}); heading there`,
    battle: 'Battle started; auto-fighting, then back to the chest',
    dialogue: 'Dialogue appeared; advancing it and moving on',
    resume: 'Heading to the chest again',
    opening: 'Arrived; opening the chest',
    done: 'Got the chest!',
    gone: 'The chest is gone; autopilot ended',
    offMap: 'Left the chest’s map; autopilot ended',
    noPath: 'No path to the chest; autopilot ended',
    locked: 'The chest will not open; autopilot ended',
    alreadyOpened: 'This chest is already open; autopilot ended',
    gameover: 'The party fell; autopilot ended',
  },
  ja: {
    marked: (x: number, y: number) => `宝箱の位置（${x}, ${y}）をマークしました。向かいます`,
    battle: '戦闘になりました。自動で戦い、終わったら宝箱へ向かいます',
    dialogue: '会話が始まりました。進めてから向かいます',
    resume: 'もう一度宝箱へ向かいます',
    opening: '着きました。宝箱を開けます',
    done: '宝箱を手に入れました！',
    gone: '宝箱が見当たりません。おまかせを終了しました',
    offMap: '宝箱のあるマップを離れました。おまかせを終了しました',
    noPath: '宝箱への道が見つかりません。おまかせを終了しました',
    locked: '宝箱が開きません。おまかせを終了しました',
    alreadyOpened: 'この宝箱はすでに開いています。おまかせを終了しました',
    gameover: 'パーティが全滅しました。おまかせを終了しました',
  },
  ko: {
    marked: (x: number, y: number) => `보물상자 위치(${x}, ${y})를 표시했어요. 가는 중이에요`,
    battle: '전투가 시작됐어요. 자동으로 싸운 뒤 보물상자로 갈게요',
    dialogue: '대화가 나왔어요. 넘기고 계속 갈게요',
    resume: '다시 보물상자로 가는 중이에요',
    opening: '도착했어요. 보물상자를 여는 중이에요',
    done: '보물상자를 얻었어요!',
    gone: '보물상자가 없어졌어요. 맡기기를 끝냈어요',
    offMap: '보물상자가 있는 지도를 벗어났어요. 맡기기를 끝냈어요',
    noPath: '보물상자로 가는 길을 찾지 못했어요. 맡기기를 끝냈어요',
    locked: '보물상자가 열리지 않아요. 맡기기를 끝냈어요',
    alreadyOpened: '이 보물상자는 이미 열려 있어요. 맡기기를 끝냈어요',
    gameover: '파티가 전멸했어요. 맡기기를 끝냈어요',
  },
}

const rm = () => globalThis as unknown as RmGlobals

function inScene(name: 'Scene_Map' | 'Scene_Battle' | 'Scene_Gameover' | 'Scene_MenuBase') {
  const Scene = rm()[name]
  return typeof Scene === 'function' && rm().SceneManager?._scene instanceof Scene
}

function chestIsOpened(event: GameEvent) {
  return event._erased === true || ((event._pageIndex ?? 0) > 0 && (event._direction === 8 || event._characterName === ''))
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(done, ms)
    function done() {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * 走到宝箱旁并打开它。战斗、对话和过场只会让托管暂停：自动战斗、推进对话后重新标记目的地继续走；
 * 只有宝箱消失、离开地图、无路可走、全灭或玩家停止才会结束。
 */
export async function runChestRoutine(routine: Extract<AgentRoutine, { kind: 'chest' }>, io: ChestRoutineIo): Promise<string> {
  const copy = COPY[(io.locale || 'zh').slice(0, 2) as keyof typeof COPY] || COPY.en
  const { mapId, eventId, x, y } = routine
  const fail = (message: string) => new Error(message)
  const map = rm().$gameMap
  const chest = map?.event?.(eventId)
  if (!inScene('Scene_Map') || map?.mapId() !== mapId || !chest) throw fail(copy.gone)
  if (chestIsOpened(chest)) return copy.alreadyOpened
  const initialPage = chest._pageIndex
  let phase = ''
  const report = (next: string, text: string) => {
    if (phase === next) return
    phase = next
    io.report(text)
  }
  const mark = () => {
    const temp = rm().$gameTemp
    if (!temp) return
    // 直接写字段：关闭点击移动时 setDestination 会被换成空操作
    temp._destinationX = x
    temp._destinationY = y
  }
  mark()
  report('walk', copy.marked(x, y))
  try {
    return await walkAndOpen()
  } finally {
    const temp = rm().$gameTemp
    if (temp && temp._destinationX === x && temp._destinationY === y) {
      temp._destinationX = null
      temp._destinationY = null
    }
  }

  async function walkAndOpen(): Promise<string> {
    let triggered = false
    let openTries = 0
    let lastSpot = ''
    let lastProgressAt = Date.now()

    for (;;) {
      await wait(TICK_MS, io.signal)
      const { $gameMap, $gamePlayer, $gameMessage, $gameTemp } = rm()
      if (inScene('Scene_Gameover')) throw fail(copy.gameover)
      if (inScene('Scene_Battle')) {
        report('battle', copy.battle)
        lastProgressAt = Date.now()
        await io.press('ok')
        continue
      }
      if ($gameMessage?.isBusy?.()) {
        if (phase !== 'opening') report('dialogue', copy.dialogue)
        lastProgressAt = Date.now()
        await io.press('ok')
        continue
      }
      if (!inScene('Scene_Map')) {
        if (inScene('Scene_MenuBase')) await io.press('cancel')
        continue
      }
      if (!$gameMap || !$gamePlayer) continue
      if ($gameMap.mapId() !== mapId) throw fail(copy.offMap)
      const event = $gameMap.event?.(eventId)
      const interpreter = $gameMap._interpreter
      if (event?.isStarting?.() || (interpreter?.eventId?.() ?? interpreter?._eventId) === eventId) triggered = true
      if ($gameMap.isEventRunning?.()) {
        lastProgressAt = Date.now()
        continue
      }
      if (event && chestIsOpened(event)) return copy.alreadyOpened
      if (triggered || !event || event._erased || event._pageIndex !== initialPage) {
        if (triggered || event?._pageIndex !== initialPage) return copy.done
        throw fail(copy.gone)
      }
      if ($gamePlayer.isMoving()) {
        lastProgressAt = Date.now()
        continue
      }
      const spot = `${$gamePlayer.x},${$gamePlayer.y}`
      if (spot !== lastSpot) {
        lastSpot = spot
        lastProgressAt = Date.now()
      }
      const dx = x - $gamePlayer.x
      const dy = y - $gamePlayer.y
      if (Math.abs(dx) + Math.abs(dy) <= 1) {
        if (++openTries > MAX_OPEN_TRIES) throw fail(copy.locked)
        if (dx || dy) $gamePlayer.setDirection?.(dx > 0 ? 6 : dx < 0 ? 4 : dy > 0 ? 2 : 8)
        report('opening', copy.opening)
        await io.press('ok')
        continue
      }
      if (!$gameTemp?.isDestinationValid()) {
        mark()
        report('walk', copy.resume)
      }
      if (Date.now() - lastProgressAt > STUCK_MS) throw fail(copy.noPath)
    }
  }
}
