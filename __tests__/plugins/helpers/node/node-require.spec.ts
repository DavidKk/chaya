/**
 * @jest-environment node
 */
import { tryNodeFsPath, tryNodeRequire } from '@/plugins/src/helpers/node/node-require'

describe('helpers/node-require', () => {
  const prev = (globalThis as { require?: unknown }).require

  afterEach(() => {
    if (prev === undefined) delete (globalThis as { require?: unknown }).require
    else (globalThis as { require?: unknown }).require = prev
  })

  it('returns null when require is missing', () => {
    delete (globalThis as { require?: unknown }).require
    expect(tryNodeRequire()).toBeNull()
    expect(tryNodeFsPath()).toBeNull()
  })

  it('returns null when require is not a function', () => {
    ;(globalThis as { require?: unknown }).require = {}
    expect(tryNodeRequire()).toBeNull()
  })

  it('returns null from tryNodeFsPath when require throws', () => {
    ;(globalThis as { require?: unknown }).require = () => {
      throw new Error('no')
    }
    // tryNodeRequire only checks typeof; it does not call require
    expect(tryNodeRequire()).toBeTruthy()
    expect(tryNodeFsPath()).toBeNull()
  })

  it('can load fs/path in a Node environment', () => {
    // jest/node provides require
    if (typeof require !== 'function') return
    ;(globalThis as { require?: NodeRequire }).require = require
    const mods = tryNodeFsPath()
    expect(typeof mods?.fs.existsSync).toBe('function')
    expect(mods?.path.join('a', 'b')).toMatch(/a/)
  })
})
