import { COMPANION_CHARACTERS, CompanionTracker, companionWords, normalizeCompanionCharacter } from '@/lib/game-agent/companion'

test('announces a nearby chest once without repeating every poll', () => {
  const tracker = new CompanionTracker()
  const state = {
    scene: 'Scene_Map',
    map: { id: 2 },
    nearbyEvents: [{ id: 1, name: '宝箱', distance: 5 }],
  }
  expect(tracker.observe(state, 0)).toBe('chest')
  expect(tracker.observe(state, 20_000)).toBeNull()
  expect(tracker.observe({ ...state, map: { id: 3 } }, 40_000)).toBe('chest')
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
