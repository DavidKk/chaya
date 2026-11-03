/**
 * @jest-environment node
 */
const startTroopBattle = jest.fn()

jest.mock('@/plugins/mv/src/cheat/runtime/cheats', () => ({ Cheats: {} }))
jest.mock('@/plugins/mv/src/cheat/session/live-troop', () => ({
  startTroopBattle: (...args: unknown[]) => startTroopBattle(...args),
}))
jest.mock('@/plugins/mv/src/cheat/session/remote-bridge', () => ({
  applyEditCmd: jest.fn(),
  buildStateMsg: jest.fn(),
  pushRemoteState: jest.fn(),
}))

import { agentEdit } from '@/plugins/mv/src/cheat/session/agent-edit'

describe('agentEdit battle:start', () => {
  afterEach(() => jest.clearAllMocks())

  it('starts the requested troop through the shared live-troop path', async () => {
    await expect(agentEdit.action({ id: 'battle:start', troopId: 35, canEscape: false, canLose: true, count: 2 })).resolves.toEqual({
      done: true,
      id: 'battle:start',
      troopId: 35,
      canEscape: false,
      canLose: true,
      count: 2,
    })
    expect(startTroopBattle).toHaveBeenCalledWith({ id: 35, canEscape: false, canLose: true, count: 2, interruptEvent: true })
  })

  it('lets live-troop choose the current map encounter when troopId is omitted', async () => {
    await agentEdit.action({ id: 'battle:start' })
    expect(startTroopBattle).toHaveBeenCalledWith({
      id: undefined,
      canEscape: undefined,
      canLose: undefined,
      count: undefined,
      interruptEvent: true,
    })
  })
})
