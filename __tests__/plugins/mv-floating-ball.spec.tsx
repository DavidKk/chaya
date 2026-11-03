/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { emptySession, type RunFlagKey } from '@/components/game-edit/types'
import type { FloatingBallRuntime } from '@/components/game-tools/FloatingBall'
import { DEFAULT_TOOL_SETTINGS } from '@/lib/game-agent/tool-settings'
import { applyRunAction, applyRunFlag } from '@/plugins/mv/src/cheat/runtime/apply-run'
import { readRunFields } from '@/plugins/mv/src/cheat/session/live-session'
import { ensureGameEditDiskApplied, scheduleSaveRunFlag } from '@/plugins/mv/src/cheat/session/persist'
import { FloatingShortcuts } from '@/plugins/mv/src/cheat/ui/FloatingShortcuts'

let mockRuntime: FloatingBallRuntime
jest.mock('@/components/game-tools/FloatingBall', () => ({
  ...jest.requireActual('@/components/game-tools/FloatingBall'),
  FloatingBall: ({ runtime }: { runtime: FloatingBallRuntime }) => {
    mockRuntime = runtime
    return null
  },
}))
jest.mock('@/plugins/mv/src/cheat/runtime/apply-run', () => ({
  applyRunFlag: jest.fn(),
  applyRunAction: jest.fn(),
  runActionNeedsClose: (id: string) => id.startsWith('scene:'),
}))
jest.mock('@/plugins/mv/src/cheat/session/live-session', () => ({ readRunFields: jest.fn() }))
jest.mock('@/plugins/mv/src/cheat/session/persist', () => ({ ensureGameEditDiskApplied: jest.fn(), scheduleSaveRunFlag: jest.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let fields: ReturnType<typeof emptySession>
let inBattle: boolean
const onClose = jest.fn()
const onRunFields = jest.fn()

beforeEach(async () => {
  fields = emptySession()
  inBattle = false
  Object.assign(globalThis, { $gameParty: { inBattle: () => inBattle }, $gameMap: { mapId: () => 1 } })
  jest.mocked(readRunFields).mockImplementation(() => fields)
  jest.mocked(applyRunFlag).mockImplementation((key: RunFlagKey, value: boolean) => {
    fields[key] = value
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<FloatingShortcuts settings={{ ...DEFAULT_TOOL_SETTINGS, floatingBallEnabled: true }} onClose={onClose} onRunFields={onRunFields} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  Reflect.deleteProperty(globalThis, '$gameParty')
  Reflect.deleteProperty(globalThis, '$gameMap')
})

it('toggles live flags and persists only the changed flag, retaining unrelated workbench fields', async () => {
  expect(await mockRuntime.read()).toMatchObject({ flags: { autoBattle: false } })
  fields.autoBattle = true
  await mockRuntime.execute('flag:autoBattle')
  expect(ensureGameEditDiskApplied).toHaveBeenCalled()
  expect(applyRunFlag).toHaveBeenCalledWith('autoBattle', false)
  expect(scheduleSaveRunFlag).toHaveBeenCalledWith('autoBattle', false)
  expect(onRunFields).toHaveBeenCalledWith({ autoBattle: false })
})

it('checks the live battle context again before executing', async () => {
  expect(() => mockRuntime.execute('action:battle:victory')).toThrow()
  expect(applyRunAction).not.toHaveBeenCalled()
  inBattle = true
  await mockRuntime.execute('action:battle:victory')
  expect(applyRunAction).toHaveBeenCalledWith('battle:victory')
})

it('closes the workbench before opening game scenes', async () => {
  jest.mocked(applyRunAction).mockImplementation(() => {
    expect(onClose).toHaveBeenCalled()
  })
  await mockRuntime.execute('action:scene:item')
  expect(applyRunAction).toHaveBeenCalledWith('scene:item')
})
