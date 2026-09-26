import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'

import { ensureNwPackageName, sanitizeNwPackageName } from '@/services/game/nw-package'

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('sanitizeNwPackageName', () => {
  it('空串回退默认', () => {
    expect(sanitizeNwPackageName('')).toBe('game')
    expect(sanitizeNwPackageName('   ')).toBe('game')
  })

  it('非法字符替换并截断', () => {
    expect(sanitizeNwPackageName('Kimochi!! 恋')).toBe('Kimochi')
    expect(sanitizeNwPackageName('a'.repeat(80)).length).toBe(64)
  })
})

describe('ensureNwPackageName', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true })
    }
  })

  it('缺少 package.json 时创建合法 name', () => {
    const root = mkTmp('chaya-nw-')
    dirs.push(root)
    const game = path.join(root, 'MyGame')
    fs.mkdirSync(game)
    const r = ensureNwPackageName(game)
    expect(r.updated).toBe(true)
    expect(r.name).toBe('MyGame')
    expect(JSON.parse(fs.readFileSync(r.file, 'utf8')).name).toBe('MyGame')
  })

  it('空 name 用 window.title 回填（Kimochi 空 name 场景）', () => {
    const root = mkTmp('chaya-nw-')
    dirs.push(root)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '', main: 'index.html', window: { title: 'Kimochi' } }))
    const r = ensureNwPackageName(root)
    expect(r.updated).toBe(true)
    expect(r.name).toBe('Kimochi')
  })

  it('已合法则不写盘', () => {
    const root = mkTmp('chaya-nw-')
    dirs.push(root)
    const file = path.join(root, 'package.json')
    fs.writeFileSync(file, JSON.stringify({ name: 'ok-game', main: 'index.html' }, null, 2))
    const before = fs.readFileSync(file, 'utf8')
    const r = ensureNwPackageName(root)
    expect(r.updated).toBe(false)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })

  it('www 内容根用父目录名', () => {
    const root = mkTmp('chaya-nw-')
    dirs.push(root)
    const www = path.join(root, 'TitleGame', 'www')
    fs.mkdirSync(www, { recursive: true })
    const r = ensureNwPackageName(www)
    expect(r.name).toBe('TitleGame')
  })
})
