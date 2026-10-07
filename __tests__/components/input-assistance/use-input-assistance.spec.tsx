/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { type GameToolTransport, GameToolTransportContext } from '@/components/game-tools/transport'
import { useInputAssistance } from '@/components/input-assistance/useInputAssistance'
import { EMPTY_INPUT_ASSIST_CONFIG, type InputAssistConfig, type MappingRule } from '@/lib/game/input-assistance'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
if (!globalThis.crypto?.randomUUID) Object.assign(globalThis, { crypto: { randomUUID: () => Math.random().toString(36).slice(2) } })

const rule: MappingRule = {
  id: 'map',
  name: '映射',
  enabled: true,
  trigger: [{ kind: 'key', code: 'KeyQ', key: 'q', keyCode: 81, location: 0 }],
  originalInput: 'replace',
  kind: 'mapping',
  output: [{ kind: 'key', code: 'KeyW', key: 'w', keyCode: 87, location: 0 }],
}

function config(revision: number, rules: InputAssistConfig['rules'] = []): InputAssistConfig {
  return { ...EMPTY_INPUT_ASSIST_CONFIG, revision, rules }
}

let host: HTMLDivElement
let root: Root
let state: ReturnType<typeof useInputAssistance>

function Probe() {
  const value = useInputAssistance()
  useEffect(() => {
    state = value
  })
  return null
}

/** 模拟游戏端：snapshot 返回给定配置，configure 原样接受 */
function fakeGame(remote: { global: InputAssistConfig; game: InputAssistConfig }) {
  const listeners = new Set<(message: GameLinkMessage) => void>()
  const sent: GameLinkMessage[] = []
  const transport: GameToolTransport = {
    roomId: 'room',
    connected: true,
    negotiating: false,
    localGlobal: true,
    send(message) {
      sent.push(message)
      if (message.type !== 'assist.cmd') return
      if (message.op === 'configure') remote = { global: message.globalConfig, game: message.gameConfig }
      const reply: GameLinkMessage = {
        type: 'assist.reply',
        reqId: message.reqId,
        ok: true,
        globalConfig: remote.global,
        gameConfig: remote.game,
        status: { running: [], pending: [], counts: {}, recording: false },
      }
      queueMicrotask(() => listeners.forEach((listener) => listener(reply)))
    },
    subscribeMessages(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const push = (message: GameLinkMessage) => listeners.forEach((listener) => listener(message))
  return { transport, sent, push }
}

async function render(transport: GameToolTransport) {
  await act(async () =>
    root.render(
      <GameToolTransportContext value={transport}>
        <Probe />
      </GameToolTransportContext>
    )
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

it('adopts a newer global config edited on the other side instead of failing', async () => {
  localStorage.setItem('chaya:input-assistance:global', JSON.stringify(config(1)))
  const game = fakeGame({ global: config(3, [rule]), game: config(0) })
  await render(game.transport)

  expect(state.error).toBe('')
  expect(state.ready).toBe(true)
  expect(state.globalConfig.revision).toBe(3)
  expect(JSON.parse(localStorage.getItem('chaya:input-assistance:global')!).revision).toBe(3)
  expect(game.sent.some((message) => message.type === 'assist.cmd' && message.op === 'configure')).toBe(false)
})

it('pushes the local copy to the game when it is newer', async () => {
  localStorage.setItem('chaya:input-assistance:game:room', JSON.stringify(config(4, [rule])))
  const game = fakeGame({ global: config(0), game: config(2) })
  await render(game.transport)

  expect(state.gameConfig.revision).toBe(4)
  expect(game.sent).toContainEqual(expect.objectContaining({ type: 'assist.cmd', op: 'configure', gameConfig: config(4, [rule]) }))
})

it('follows assist.config pushes from the game', async () => {
  const game = fakeGame({ global: config(0), game: config(0) })
  await render(game.transport)
  await act(async () => {
    game.push({ type: 'assist.config', globalConfig: config(0), gameConfig: config(5, [rule]) })
    await Promise.resolve()
  })

  expect(state.gameConfig).toEqual(config(5, [rule]))
  expect(JSON.parse(localStorage.getItem('chaya:input-assistance:game:room')!).revision).toBe(5)
})
