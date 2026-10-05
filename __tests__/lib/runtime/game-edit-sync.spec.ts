import { emptySession } from '@/components/game-edit/types'
import { type EditPendingMap, expectForEditCmd, fieldsForEditCmd, mergeRemoteSession } from '@/lib/runtime/game-edit-sync'
import type { GameEditCmd } from '@/lib/runtime/game-link-protocol'

const cmd = (op: 'moveRate' | 'gameSpeed', value: number): GameEditCmd => ({ type: 'edit.cmd', cmdId: 't', op, value })

describe('game-edit-sync speed ops', () => {
  it('moveRate covers walk + run; gameSpeed has its own field', () => {
    expect(fieldsForEditCmd(cmd('moveRate', 2))).toEqual(['walkRate', 'runRate'])
    expect(fieldsForEditCmd(cmd('gameSpeed', 3))).toEqual(['gameSpeed'])
    expect(expectForEditCmd(cmd('moveRate', 2))).toBe(2)
    expect(expectForEditCmd(cmd('gameSpeed', 3))).toBe(3)
  })

  it('pending gameSpeed keeps the optimistic value until the remote matches', () => {
    const prev = { ...emptySession(), gameSpeed: 3 }
    const pending: EditPendingMap = new Map([['gameSpeed', { cmdId: 'a', expect: 3, startedAt: 0, sentAt: 0, cmd: cmd('gameSpeed', 3) }]])
    const { hotkeys: _h, hotkeysGlobal: _g, ...stale } = { ...emptySession(), gameSpeed: 1 }
    const blocked = mergeRemoteSession(prev, stale, pending)
    expect(blocked.session.gameSpeed).toBe(3)
    expect(blocked.matchedFields).toEqual([])

    const landed = mergeRemoteSession(prev, { ...stale, gameSpeed: 3 }, pending)
    expect(landed.matchedFields).toEqual(['gameSpeed'])
    expect(landed.session.gameSpeed).toBe(3)
  })
})
