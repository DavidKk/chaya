/** @jest-environment jsdom */
import { EMPTY_INPUT_ASSIST_CONFIG, type InputAssistConfig, type TurboRule } from '@/lib/game/input-assistance'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { InputAssistanceController } from '@/plugins/src/cheat/input-assistance/controller'

jest.mock('@/plugins/src/helpers/node/node-require', () => ({ tryNodeFsPath: () => null, tryNodeRequire: () => null }))

const turbo: TurboRule = {
  id: 'turbo',
  name: '连发',
  enabled: true,
  trigger: [{ kind: 'key', code: 'KeyQ', key: 'q', keyCode: 81, location: 0 }],
  originalInput: 'replace',
  kind: 'turbo',
  output: [{ kind: 'key', code: 'KeyQ', key: 'q', keyCode: 81, location: 0 }],
  interval: { minMs: 100, maxMs: 100 },
}

function config(revision: number, rules: InputAssistConfig['rules'] = []): InputAssistConfig {
  return { ...EMPTY_INPUT_ASSIST_CONFIG, revision, rules }
}

let controller: InputAssistanceController

beforeEach(() => {
  localStorage.clear()
  controller = new InputAssistanceController()
})

afterEach(() => controller.dispose())

it('pushes overlay config changes to the connected web client without taking over its channel', () => {
  const link: GameLinkMessage[] = []
  const overlay: GameLinkMessage[] = []
  controller.handle({ type: 'assist.cmd', reqId: 'web-1', gameId: 'default', op: 'snapshot' }, (message) => link.push(message))

  controller.request({ type: 'assist.cmd', reqId: 'overlay-1', gameId: 'default', op: 'configure', globalConfig: config(0), gameConfig: config(1, [turbo]) }, (message) =>
    overlay.push(message)
  )

  expect(overlay).toEqual([expect.objectContaining({ type: 'assist.reply', reqId: 'overlay-1', ok: true })])
  expect(link.at(-1)).toEqual({ type: 'assist.config', globalConfig: config(0), gameConfig: config(1, [turbo]) })

  controller.runtime.start('turbo')
  expect(link.at(-1)).toEqual(expect.objectContaining({ type: 'assist.status' }))
  expect(overlay.some((message) => message.type === 'assist.status')).toBe(false)
  controller.runtime.stopAll()
})

it('delivers a recording result to whoever started it', async () => {
  const link: GameLinkMessage[] = []
  const overlay: GameLinkMessage[] = []
  controller.handle({ type: 'assist.cmd', reqId: 'web-1', gameId: 'default', op: 'snapshot' }, (message) => link.push(message))
  controller.request({ type: 'assist.cmd', reqId: 'overlay-1', gameId: 'default', op: 'recordStart', kind: 'binding' }, (message) => overlay.push(message))
  controller.request({ type: 'assist.cmd', reqId: 'overlay-2', gameId: 'default', op: 'recordCancel' }, (message) => overlay.push(message))
  await Promise.resolve()

  expect(overlay).toContainEqual({ type: 'assist.recorded', result: null })
  expect(link.some((message) => message.type === 'assist.recorded')).toBe(false)
})

it('rejects commands for another game', () => {
  const overlay: GameLinkMessage[] = []
  controller.request({ type: 'assist.cmd', reqId: 'overlay-1', gameId: 'other', op: 'snapshot' }, (message) => overlay.push(message))
  expect(overlay).toEqual([expect.objectContaining({ ok: false, error: '游戏连接已切换，请重新打开辅助页' })])
})
