import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'

import { SHELL_APP_NAME } from '@/constants/brand'
import { findNwMacBinary } from '@/lib/game/shell-layout'
import { installShell, isToolkitShellInstalled, uninstallToolkitShell } from '@/services/game/shell'

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** 最小可拷贝的假 NW.js .app */
function writeFakeNwApp(appPath: string, binName = 'nwjs') {
  fs.mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true })
  fs.mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true })
  fs.writeFileSync(path.join(appPath, 'Contents', 'MacOS', binName), '#!/bin/sh\n')
  fs.chmodSync(path.join(appPath, 'Contents', 'MacOS', binName), 0o755)
}

const describeMac = process.platform === 'darwin' ? describe : describe.skip

describeMac('shell install / uninstall 核心流程', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true })
    }
  })

  it('安装共用壳 → 重链 app.nw → 卸载只删 data/shell', () => {
    const toolkitRoot = mkTmp('chaya-toolkit-')
    const contentRoot = mkTmp('chaya-content-')
    const shellSource = path.join(mkTmp('chaya-src-'), 'nwjs.app')
    dirs.push(toolkitRoot, contentRoot, path.dirname(shellSource))

    writeFakeNwApp(shellSource)
    fs.writeFileSync(path.join(contentRoot, 'package.json'), JSON.stringify({ name: 'demo', main: 'index.html' }))
    fs.writeFileSync(path.join(contentRoot, 'index.html'), '<html></html>')

    expect(isToolkitShellInstalled(toolkitRoot)).toBe(false)

    const installed = installShell({ shellSource, contentRoot, toolkitRoot })
    expect(installed.created).toBe(true)
    expect(installed.relinked).toBe(true)
    expect(fs.existsSync(installed.shellApp)).toBe(true)
    expect(path.basename(installed.shellApp)).toBe(SHELL_APP_NAME)
    expect(isToolkitShellInstalled(toolkitRoot)).toBe(true)

    const link = path.join(installed.shellApp, 'Contents/Resources/app.nw')
    expect(fs.lstatSync(link).isSymbolicLink() || fs.existsSync(link)).toBe(true)
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(contentRoot))

    expect(fs.existsSync(shellSource)).toBe(true)

    const bin = findNwMacBinary(installed.shellApp)
    expect(bin.endsWith(`${path.sep}nwjs`)).toBe(true)

    const un = uninstallToolkitShell(toolkitRoot)
    expect(un.removed.length).toBeGreaterThanOrEqual(1)
    expect(isToolkitShellInstalled(toolkitRoot)).toBe(false)
    expect(fs.existsSync(installed.shellApp)).toBe(false)
    expect(fs.existsSync(contentRoot)).toBe(true)
    expect(fs.existsSync(shellSource)).toBe(true)
  })

  it('复用已装壳时只重链到新内容根', () => {
    const toolkitRoot = mkTmp('chaya-toolkit-')
    const contentA = mkTmp('chaya-a-')
    const contentB = mkTmp('chaya-b-')
    const shellSource = path.join(mkTmp('chaya-src-'), 'nwjs.app')
    dirs.push(toolkitRoot, contentA, contentB, path.dirname(shellSource))

    writeFakeNwApp(shellSource)
    for (const root of [contentA, contentB]) {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: path.basename(root), main: 'index.html' }))
    }

    const first = installShell({ shellSource, contentRoot: contentA, toolkitRoot })
    expect(first.created).toBe(true)

    const second = installShell({ shellSource, contentRoot: contentB, toolkitRoot })
    expect(second.created).toBe(false)
    expect(second.relinked).toBe(true)
    expect(fs.realpathSync(path.join(second.shellApp, 'Contents/Resources/app.nw'))).toBe(fs.realpathSync(contentB))
  })

  it('force 可覆盖已装壳', () => {
    const toolkitRoot = mkTmp('chaya-toolkit-')
    const contentRoot = mkTmp('chaya-content-')
    const srcA = path.join(mkTmp('chaya-src-a-'), 'nwjs.app')
    const srcB = path.join(mkTmp('chaya-src-b-'), 'nwjs.app')
    dirs.push(toolkitRoot, contentRoot, path.dirname(srcA), path.dirname(srcB))

    writeFakeNwApp(srcA, 'nwjs')
    writeFakeNwApp(srcB, 'nwjs')
    fs.writeFileSync(path.join(srcB, 'Contents', 'MacOS', 'marker-b'), 'b')
    fs.writeFileSync(path.join(contentRoot, 'package.json'), JSON.stringify({ name: 'demo', main: 'index.html' }))

    const first = installShell({ shellSource: srcA, contentRoot, toolkitRoot })
    expect(first.created).toBe(true)
    expect(fs.existsSync(path.join(first.shellApp, 'Contents', 'MacOS', 'marker-b'))).toBe(false)

    const forced = installShell({ shellSource: srcB, contentRoot, toolkitRoot, force: true })
    expect(forced.created).toBe(true)
    expect(fs.existsSync(path.join(forced.shellApp, 'Contents', 'MacOS', 'marker-b'))).toBe(true)
  })

  it('卸载不存在的壳时 removed 为空', () => {
    const toolkitRoot = mkTmp('chaya-empty-')
    dirs.push(toolkitRoot)
    expect(uninstallToolkitShell(toolkitRoot).removed).toEqual([])
  })

  it('拒绝把内容根装进已打包 .app 的 Contents', () => {
    const toolkitRoot = mkTmp('chaya-toolkit-')
    const gameApp = path.join(mkTmp('chaya-game-'), 'Game.app')
    const shellSource = path.join(mkTmp('chaya-src-'), 'nwjs.app')
    dirs.push(toolkitRoot, path.dirname(gameApp), path.dirname(shellSource))

    writeFakeNwApp(shellSource)
    writeFakeNwApp(gameApp)
    const nested = path.join(gameApp, 'Contents/Resources/app.nw')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'bundled', main: 'index.html' }))

    expect(() => installShell({ shellSource, contentRoot: nested, toolkitRoot })).toThrow(/已是 NW\.js 打包应用/)
  })
})

describeMac('findNwMacBinary', () => {
  it('优先 nwjs，否则匹配 nw*', () => {
    const app = path.join(mkTmp('chaya-bin-'), 'X.app')
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'nwjs Helper'), 'x')
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'nwjs'), 'x')
    try {
      expect(findNwMacBinary(app)).toBe(path.join(app, 'Contents', 'MacOS', 'nwjs'))
    } finally {
      fs.rmSync(path.dirname(app), { recursive: true, force: true })
    }
  })
})
