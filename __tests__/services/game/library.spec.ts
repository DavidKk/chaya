import { describe, expect, it } from '@jest/globals'

import { parseLibrarySortMode, sortLibraryEntries } from '@/lib/game/library-sort'
import { displayNameFromPath, isLibraryEntryId, normalizeLibrary, pathEquals, reconcileLibraryConfig, sameGameFamily, upsertLibraryEntry } from '@/services/game/library'

describe('library path / id', () => {
  it('pathEquals 忽略尾随斜杠', () => {
    expect(pathEquals('/Games/A', '/Games/A/')).toBe(true)
    expect(pathEquals('/Games/A', '/Games/B')).toBe(false)
    expect(pathEquals('', '/Games/A')).toBe(false)
  })

  it('sameGameFamily：同路径或同 .app 包', () => {
    expect(sameGameFamily('/g/Foo.app', '/g/Foo.app/')).toBe(true)
    expect(sameGameFamily('/g/Foo.app/Contents/Resources/app.nw', '/g/Foo.app')).toBe(true)
    expect(sameGameFamily('/g/A.app', '/g/B.app')).toBe(false)
  })

  it('isLibraryEntryId 只认 UUID', () => {
    expect(isLibraryEntryId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isLibraryEntryId('not-a-uuid')).toBe(false)
  })

  it('displayNameFromPath 去掉 .app', () => {
    expect(displayNameFromPath('/Games/Kimochi.app')).toBe('Kimochi')
    expect(displayNameFromPath('/Games/www')).toBe('www')
  })
})

describe('library upsert / normalize 顺序', () => {
  it('更新已有条目不改变数组位置', () => {
    const a = { id: '11111111-1111-4111-8111-111111111111', gameRoot: '/Games/A', name: 'A', lastOpenedAt: 1, addedAt: 1 }
    const b = { id: '22222222-2222-4222-8222-222222222222', gameRoot: '/Games/B', name: 'B', lastOpenedAt: 2, addedAt: 2 }
    const next = upsertLibraryEntry([a, b], { gameRoot: '/Games/A', name: 'A2' })
    expect(next.map((e) => e.id)).toEqual([a.id, b.id])
    expect(next[0]?.name).toBe('A2')
    expect(next[0]?.addedAt).toBe(1)
    expect(next[0]!.lastOpenedAt).toBeGreaterThan(1)
  })

  it('新条目追加到末尾并写入 addedAt', () => {
    const a = { id: '11111111-1111-4111-8111-111111111111', gameRoot: '/Games/A', name: 'A', lastOpenedAt: 1, addedAt: 1 }
    const next = upsertLibraryEntry([a], { gameRoot: '/Games/B', name: 'B' })
    expect(next).toHaveLength(2)
    expect(next[1]?.name).toBe('B')
    expect(next[1]?.addedAt).toBeGreaterThan(0)
  })

  it('normalize 补齐 addedAt，且不按 lastOpened 重排', () => {
    const list = normalizeLibrary([
      { id: '11111111-1111-4111-8111-111111111111', gameRoot: '/Games/Z', name: 'Z', lastOpenedAt: 10 },
      { id: '22222222-2222-4222-8222-222222222222', gameRoot: '/Games/A', name: 'A', lastOpenedAt: 99 },
    ])
    expect(list.map((e) => e.name)).toEqual(['Z', 'A'])
    expect(list[0]?.addedAt).toBe(10)
  })
})

describe('library sort', () => {
  const entries = [
    { id: 'b', name: 'Banana', lastOpenedAt: 20, addedAt: 2 },
    { id: 'a', name: 'Apple', lastOpenedAt: 10, addedAt: 3 },
    { id: 'c', name: 'Cherry', remark: 'Zebra', lastOpenedAt: 30, addedAt: 1 },
  ]

  it('默认名称（含备注优先）', () => {
    expect(parseLibrarySortMode(null)).toBe('name')
    expect(sortLibraryEntries(entries, 'name').map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('最后打开：新→旧', () => {
    expect(sortLibraryEntries(entries, 'lastOpened').map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('安装时间：新→旧', () => {
    expect(sortLibraryEntries(entries, 'addedAt').map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('unavailable library paths', () => {
  it('preserves selection, notes and identifiers when a volume is disconnected', () => {
    const root = '/__chaya_unmounted_volume__/Game'
    const entry = { id: '11111111-1111-4111-8111-111111111111', gameRoot: root, name: 'Game', remark: 'Keep me', addedAt: 1, lastOpenedAt: 1 }
    const config = { gameRoot: root, shellSource: '', library: [entry] }
    expect(reconcileLibraryConfig(config)).toEqual({ config, changed: false, pruned: [], switchedTo: null })
  })
})
