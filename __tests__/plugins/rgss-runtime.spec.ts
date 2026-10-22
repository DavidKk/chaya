import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** Run actual Ruby adapters against fake RGSS objects, without launching a game. */
it('round-trips RGSS saves, validates paths, and preserves the original globals', () => {
  const result = execFileSync('ruby', [path.join(process.cwd(), '__tests__/plugins/rgss-runtime.rb')], { encoding: 'utf8' })
  expect(result.trim()).toBe('RGSS runtime assertions passed')
})

it('validates RGSS mouse movement pathfinding and keyboard interrupt', () => {
  const result = execFileSync('ruby', [path.join(process.cwd(), '__tests__/plugins/rgss-mouse-movement.rb')], { encoding: 'utf8' })
  expect(result.trim()).toBe('RGSS mouse movement unit tests passed')
})

it('validates RGSS hotreload and user32 screen dimension stability', () => {
  const result = execFileSync('ruby', [path.join(process.cwd(), '__tests__/plugins/rgss-test-hotreload.rb')], { encoding: 'utf8' })
  expect(result.trim()).toBe('RGSS hotreload and user32 tests passed')
})

it('validates RGSS A* obstacle navigation', () => {
  const result = execFileSync('ruby', [path.join(process.cwd(), '__tests__/plugins/rgss-test-astar.rb')], { encoding: 'utf8' })
  expect(result.trim()).toContain('A* unit tests passed!')
})
