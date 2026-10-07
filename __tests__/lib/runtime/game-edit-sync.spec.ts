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

  it('troop battles only wait for the ack', () => {
    const troop: GameEditCmd = { type: 'edit.cmd', cmdId: 't', op: 'troop', id: 4, canEscape: true, canLose: false }
    expect(fieldsForEditCmd(troop)).toEqual(['action:troop:4'])
    expect(expectForEditCmd(troop)).toBe(true)
  })

  it('battle enemy edits only wait for the ack', () => {
    const transform: GameEditCmd = { type: 'edit.cmd', cmdId: 'a', op: 'enemyTransform', index: 2, fromEnemyId: 1, enemyId: 5 }
    const add: GameEditCmd = { type: 'edit.cmd', cmdId: 'b', op: 'enemyAdd', enemyId: 5 }
    expect(fieldsForEditCmd(transform)).toEqual(['action:enemyTransform:2'])
    expect(fieldsForEditCmd(add)).toEqual(['action:enemyAdd'])
    expect(expectForEditCmd(transform)).toBe(true)
    expect(expectForEditCmd(add)).toBe(true)
    const kill: GameEditCmd = { type: 'edit.cmd', cmdId: 'c', op: 'enemyKill', index: 1, fromEnemyId: 1 }
    expect(fieldsForEditCmd(kill)).toEqual(['action:enemyKill:1'])
    expect(expectForEditCmd(kill)).toBe(true)
    const revive: GameEditCmd = { type: 'edit.cmd', cmdId: 'f', op: 'enemyRevive', index: 1, fromEnemyId: 1 }
    expect(fieldsForEditCmd(revive)).toEqual(['action:enemyRevive:1'])
    const recover: GameEditCmd = { type: 'edit.cmd', cmdId: 'r', op: 'enemyRecover', index: 1, fromEnemyId: 1 }
    expect(fieldsForEditCmd(recover)).toEqual(['action:enemyRecover:1'])
    expect(expectForEditCmd(recover)).toBe(true)
    expect(expectForEditCmd(revive)).toBe(true)
    const hp: GameEditCmd = { type: 'edit.cmd', cmdId: 'd', op: 'enemyHp', index: 0, fromEnemyId: 1, hp: 5 }
    expect(fieldsForEditCmd(hp)).toEqual(['action:enemyHp:0'])
    expect(expectForEditCmd(hp)).toBe(true)
    const mhp: GameEditCmd = { type: 'edit.cmd', cmdId: 'e', op: 'enemyMhp', index: 0, fromEnemyId: 1, mhp: 50 }
    expect(fieldsForEditCmd(mhp)).toEqual(['action:enemyMhp:0'])
    expect(expectForEditCmd(mhp)).toBe(true)
  })

  it('party battle ops are per-actor actions', () => {
    const vital: GameEditCmd = { type: 'edit.cmd', cmdId: 'f', op: 'actorVital', actorId: 3, key: 'mmp', value: 80 }
    expect(fieldsForEditCmd(vital)).toEqual(['action:actorVital:3:mmp'])
    expect(expectForEditCmd(vital)).toBe(true)
    const revive: GameEditCmd = { type: 'edit.cmd', cmdId: 'g', op: 'actorRevive', actorId: 3 }
    expect(fieldsForEditCmd(revive)).toEqual(['action:actorRevive:3'])
    const recover: GameEditCmd = { type: 'edit.cmd', cmdId: 'h', op: 'actorRecover', actorId: 3 }
    expect(fieldsForEditCmd(recover)).toEqual(['action:actorRecover:3'])
    const join: GameEditCmd = { type: 'edit.cmd', cmdId: 'j', op: 'actorJoin', actorId: 5 }
    expect(fieldsForEditCmd(join)).toEqual(['action:actorJoin:5'])
    expect(expectForEditCmd(join)).toBe(true)
    expect(expectForEditCmd(recover)).toBe(true)
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
