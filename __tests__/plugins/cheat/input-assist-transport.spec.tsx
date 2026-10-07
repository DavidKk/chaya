/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { InputAssistTransportContext } from '@/components/input-assistance/transport'
import { useInputAssistance } from '@/components/input-assistance/useInputAssistance'
import { EMPTY_INPUT_ASSIST_CONFIG, type MappingRule } from '@/lib/game/input-assistance'
import { InputAssistanceController } from '@/plugins/src/cheat/input-assistance/controller'
import { createPluginInputAssistTransport } from '@/plugins/src/cheat/ui/input-assist-transport'

jest.mock('@/plugins/src/helpers/node/node-require', () => ({ tryNodeFsPath: () => null, tryNodeRequire: () => null }))

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

type Host = Window & { __chayaInputAssistance?: InputAssistanceController }

let host: HTMLDivElement
let root: Root
let state: ReturnType<typeof useInputAssistance>
let controller: InputAssistanceController

function Probe() {
  const value = useInputAssistance()
  useEffect(() => {
    state = value
  })
  return null
}

beforeEach(() => {
  localStorage.clear()
  controller = new InputAssistanceController()
  ;(window as Host).__chayaInputAssistance = controller
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  controller.dispose()
  delete (window as Host).__chayaInputAssistance
  document.body.innerHTML = ''
})

it('lets the in-game overlay edit rules straight through the plugin controller', async () => {
  const transport = createPluginInputAssistTransport()
  await act(async () =>
    root.render(
      <InputAssistTransportContext value={transport}>
        <Probe />
      </InputAssistTransportContext>
    )
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(state.ready).toBe(true)
  expect(state.connected).toBe(true)

  await act(async () => state.save('game', { ...EMPTY_INPUT_ASSIST_CONFIG, revision: 1, rules: [rule] }))

  expect(state.error).toBe('')
  expect(controller.runtime.snapshot().rules.map((item) => item.id)).toEqual(['map'])
})
