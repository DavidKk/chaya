import { COMPANION_CHARACTERS, CompanionTracker, companionWords, normalizeCompanionCharacter } from '@/lib/game-agent/companion'

test('announces a nearby chest once without repeating every poll', () => {
  const tracker = new CompanionTracker()
  const state = {
    scene: 'Scene_Map',
    map: { id: 2 },
    nearbyEvents: [{ id: 1, sprite: '!Chest', effects: ['item'], distance: 5 }],
  }
  expect(tracker.observe(state, 0)).toBe('chest')
  expect(tracker.observe(state, 20_000)).toBeNull()
  expect(tracker.observe({ ...state, map: { id: 3 } }, 40_000)).toBe('chest')
})

test('does not announce a chest whose event has already switched to its opened page', () => {
  const tracker = new CompanionTracker()
  const state = {
    scene: 'Scene_Map',
    map: { id: 2 },
    nearbyEvents: [{ id: 1, sprite: '!Chest', effects: ['item'], distance: 5, opened: true }],
  }
  expect(tracker.observe(state, 0)).toBeNull()
})

test('recognizes a chest from what its page does, not from its name or sprite file name', () => {
  const tracker = new CompanionTracker()
  const named = { scene: 'Scene_Map', map: { id: 2 }, nearbyEvents: [{ id: 1, name: '宝箱', sprite: '!Chest', effects: ['text'], distance: 2 }] }
  expect(tracker.observe(named, 0)).toBeNull()
  const person = { scene: 'Scene_Map', map: { id: 2 }, nearbyEvents: [{ id: 2, sprite: 'People1', effects: ['text', 'item'], distance: 2 }] }
  expect(tracker.observe(person, 0)).toBeNull()
  const flame = { scene: 'Scene_Map', map: { id: 2 }, nearbyEvents: [{ id: 3, sprite: '!Flame', effects: ['text', 'gold'], distance: 2 }] }
  expect(tracker.observe(flame, 0)).toBe('chest')
})

test('remembers where the announced chest is so 托管 can walk there', () => {
  const tracker = new CompanionTracker()
  const state = { scene: 'Scene_Map', map: { id: 2 }, nearbyEvents: [{ id: 4, sprite: '!Chest', effects: ['gold'], distance: 3, x: 7, y: 9 }] }
  expect(tracker.observe(state, 0)).toBe('chest')
  expect(tracker.lastChest).toEqual({ mapId: 2, eventId: 4, x: 7, y: 9 })
  expect(tracker.observe({ ...state, map: { id: 3 }, nearbyEvents: [{ id: 1, sprite: '!Chest', effects: ['item'], distance: 3 }] }, 20_000)).toBe('chest')
  expect(tracker.lastChest).toBeNull()
})

test('prioritizes low HP, then speaks again only after recovery and a new drop', () => {
  const tracker = new CompanionTracker()
  const battle = (hp: number) => ({ scene: 'Scene_Battle', battle: { instanceId: 'battle-1' }, party: [{ id: 1, hp, mhp: 100 }] })
  expect(tracker.observe(battle(30), 0)).toBe('danger')
  expect(tracker.observe(battle(25), 20_000)).toBeNull()
  expect(tracker.observe(battle(70), 30_000)).toBeNull()
  expect(tracker.observe(battle(30), 40_000)).toBe('danger')
})

test('uses distinct localized wording for each companion character', () => {
  const words = companionWords('zh')
  expect(new Set(COMPANION_CHARACTERS.map((character) => words.lines[character].danger)).size).toBe(COMPANION_CHARACTERS.length)
  expect(companionWords('en').lines.rin.chest).toContain('chest')
  expect(normalizeCompanionCharacter('steady')).toBe('nagi')
})
