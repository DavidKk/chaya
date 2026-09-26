import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

jest.mock('@/constants/paths', () => ({
  ROOT_PATH: '/tmp/chaya-resolve-test-root',
}))

import { looksLikeContent, resolveGame } from '@/lib/game/resolve'

function touchContentRoot(dir: string) {
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>\n')
}

describe('resolveGame packaged .app', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-resolve-app-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('resolves Contents/Resources/app.nw inside a .app bundle', () => {
    const app = path.join(root, 'Game.app')
    const appNw = path.join(app, 'Contents/Resources/app.nw')
    touchContentRoot(appNw)
    const r = resolveGame(app)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.kind).toBe('app.nw')
    expect(r.contentRoot).toBe(path.resolve(appNw))
    expect(r.projectRoot).toBe(path.resolve(app))
    expect(r.bundled).toBe(true)
  })

  it('resolves a parent folder that contains exactly one content .app', () => {
    const app = path.join(root, 'nwjs.app')
    touchContentRoot(path.join(app, 'Contents/Resources/app.nw'))
    const r = resolveGame(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.contentRoot).toBe(path.resolve(path.join(app, 'Contents/Resources/app.nw')))
  })

  it('errors when parent folder has multiple content .apps', () => {
    for (const name of ['A.app', 'B.app']) {
      touchContentRoot(path.join(root, name, 'Contents/Resources/app.nw'))
    }
    const r = resolveGame(root)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/多个可用 \.app/)
  })

  it('looksLikeContent requires index + data + js', () => {
    const dir = path.join(root, 'www')
    fs.mkdirSync(dir, { recursive: true })
    expect(looksLikeContent(dir)).toBe(false)
    touchContentRoot(dir)
    expect(looksLikeContent(dir)).toBe(true)
  })
})
