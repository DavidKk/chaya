/**
 * @jest-environment node
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { detectGameIdentity } from '@/plugins/src/helpers/game/game-identity'

describe('helpers/game-identity', () => {
  let root: string
  const prevCwd = process.cwd()

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-gid-')))
    ;(globalThis as { require?: NodeRequire }).require = require
    delete (globalThis as { $dataSystem?: unknown }).$dataSystem
  })

  afterEach(() => {
    process.chdir(prevCwd)
    fs.rmSync(root, { recursive: true, force: true })
    delete (globalThis as { $dataSystem?: unknown }).$dataSystem
  })

  function plantContent(dir: string, pkg?: object) {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
    if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
  }

  it('returns null without require', () => {
    delete (globalThis as { require?: unknown }).require
    expect(detectGameIdentity()).toBeNull()
  })

  it('detects cwd content root and package title', () => {
    plantContent(root, { window: { title: 'テストRPG' }, name: 'ignored' })
    process.chdir(root)
    const id = detectGameIdentity()
    expect(id?.contentRoot).toBe(path.resolve(root))
    expect(id?.name).toBe('テストRPG')
  })

  it('detects www subdirectory: gameRoot is the parent', () => {
    const www = path.join(root, 'www')
    plantContent(www, { name: 'shell-game' })
    process.chdir(root)
    const id = detectGameIdentity()
    expect(id?.contentRoot).toBe(path.resolve(www))
    expect(id?.gameRoot).toBe(path.resolve(root))
    expect(id?.name).toBe('shell-game')
  })

  it('$dataSystem.gameTitle takes priority over package', () => {
    plantContent(root, { name: 'pkg' })
    ;(globalThis as { $dataSystem?: { gameTitle: string } }).$dataSystem = { gameTitle: '  In-game Title  ' }
    process.chdir(root)
    expect(detectGameIdentity()?.name).toBe('In-game Title')
  })

  it('returns null when cwd is not a content root (missing data)', () => {
    fs.mkdirSync(path.join(root, 'js'), { recursive: true })
    fs.writeFileSync(path.join(root, 'index.html'), 'x')
    process.chdir(root)
    expect(detectGameIdentity()).toBeNull()
  })
})
