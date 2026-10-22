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
