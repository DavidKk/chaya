import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveGame } from '@/lib/game/resolve'

function touchContentRoot(dir: string) {
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>\n')
}

describe('resolveGame project shell', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-resolve-shell-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('ignores a half-deleted shell next to www so it can be installed again', () => {
    const www = path.join(root, 'www')
    touchContentRoot(www)
    const shell = path.join(root, 'Chaya.app')
    fs.mkdirSync(path.join(shell, 'Contents/Frameworks'), { recursive: true })
    const broken = resolveGame(www, path.join(root, 'toolkit'))
    expect(broken.ok && broken.hasShell).toBe(false)

    if (process.platform === 'darwin') {
      fs.mkdirSync(path.join(shell, 'Contents/MacOS'))
      fs.writeFileSync(path.join(shell, 'Contents/MacOS/nwjs'), '')
    } else {
      fs.writeFileSync(path.join(shell, 'nw'), '')
    }
    const valid = resolveGame(www, path.join(root, 'toolkit'))
    expect(valid.ok && valid.hasShell).toBe(true)
    expect(valid.ok && valid.shellApp).toBe(shell)
  })
})
