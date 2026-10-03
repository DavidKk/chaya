import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ensureShellLinkedToContent, installShell, recoverOldIfNeeded, uninstallToolkitShell, validShellExists } from '@/services/game/shell'

const realPlatform = process.platform
const dirs: string[] = []

function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(d)
  return d
}

/** Linux 布局的假 NW.js：目录内含 `nw` 可执行文件 */
function writeFakeLinuxNw(dir: string, marker: string): string {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'nw'), '#!/bin/sh\n')
  fs.writeFileSync(path.join(dir, 'marker.txt'), marker)
  return dir
}

function setup() {
  const toolkitRoot = mkTmp('chaya-toolkit-')
  const contentRoot = mkTmp('chaya-content-')
  fs.writeFileSync(path.join(contentRoot, 'package.json'), JSON.stringify({ name: 'demo', main: 'index.html' }))
  const srcA = writeFakeLinuxNw(path.join(mkTmp('chaya-src-'), 'nwjs-a'), 'A')
  const srcB = writeFakeLinuxNw(path.join(mkTmp('chaya-src-'), 'nwjs-b'), 'B')
  const shellApp = path.join(toolkitRoot, 'data', 'shell', 'Chaya')
  const old = path.join(path.dirname(shellApp), '.Chaya.old')
  const staging = path.join(path.dirname(shellApp), '.Chaya.staging')
  const broken = path.join(path.dirname(shellApp), '.Chaya.broken')
  return { toolkitRoot, contentRoot, srcA, srcB, shellApp, old, staging, broken }
}

const marker = (dir: string) => fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8')

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

const describeUnix = realPlatform === 'win32' ? describe.skip : describe

describeUnix('installShell 暂存后替换（Linux 布局）', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
    jest.restoreAllMocks()
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('首次安装：不建 app.nw，启动重链无操作', () => {
    const t = setup()
    const r = installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    expect(r).toMatchObject({ shellApp: t.shellApp, created: true, relinked: false, contentLink: t.contentRoot })
    expect(marker(t.shellApp)).toBe('A')
    expect(fs.existsSync(path.join(t.shellApp, 'Contents'))).toBe(false)
    expect(ensureShellLinkedToContent({ shellApp: t.shellApp, contentRoot: t.contentRoot })).toBe(false)
  })

  it('force 替换成功：新壳就位，不留 .old / .staging', () => {
    const t = setup()
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    installShell({ shellSource: t.srcB, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot, force: true })
    expect(marker(t.shellApp)).toBe('B')
    expect(fs.existsSync(t.old)).toBe(false)
    expect(fs.existsSync(t.staging)).toBe(false)
  })

  it('已有可用壳且不 force：直接复用', () => {
    const t = setup()
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    const r = installShell({ shellSource: t.srcB, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    expect(r.created).toBe(false)
    expect(marker(t.shellApp)).toBe('A')
  })

  it('旧壳改名一直被占用（EBUSY）：抛 SHELL_IN_USE，旧壳完好，暂存清理', () => {
    const t = setup()
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    const real = fs.renameSync
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === t.shellApp) throw errnoError('EBUSY')
      return real(from, to)
    })
    expect(() => installShell({ shellSource: t.srcB, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot, force: true })).toThrow(
      expect.objectContaining({ code: 'SHELL_IN_USE' })
    )
    expect(marker(t.shellApp)).toBe('A')
    expect(fs.existsSync(t.staging)).toBe(false)
  })

  it('暂存改正式名失败：回滚到旧壳', () => {
    const t = setup()
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    const real = fs.renameSync
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === t.staging) throw errnoError('EIO')
      return real(from, to)
    })
    expect(() => installShell({ shellSource: t.srcB, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot, force: true })).toThrow('EIO')
    expect(marker(t.shellApp)).toBe('A')
    expect(fs.existsSync(t.old)).toBe(false)
    expect(fs.existsSync(t.staging)).toBe(false)
  })

  it('回滚也失败：保留 .old 并抛 SHELL_SWAP_RECOVERY_REQUIRED；之后恢复', () => {
    const t = setup()
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    const real = fs.renameSync
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === t.staging || String(from) === t.old) throw errnoError('EIO')
      return real(from, to)
    })
    expect(() => installShell({ shellSource: t.srcB, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot, force: true })).toThrow(
      expect.objectContaining({ code: 'SHELL_SWAP_RECOVERY_REQUIRED' })
    )
    expect(fs.existsSync(t.shellApp)).toBe(false)
    expect(marker(t.old)).toBe('A')

    spy.mockRestore()
    expect(recoverOldIfNeeded(t.shellApp)).toBe(true)
    expect(marker(t.shellApp)).toBe('A')
    expect(fs.existsSync(t.old)).toBe(false)
  })

  it('安装前先恢复 .old，再正常替换', () => {
    const t = setup()
    writeFakeLinuxNw(t.old, 'A')
    installShell({ shellSource: t.srcB, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot, force: true })
    expect(marker(t.shellApp)).toBe('B')
    expect(fs.existsSync(t.old)).toBe(false)
  })

  it('正式路径是失效符号链接、.old 可用：删链接后恢复', () => {
    const t = setup()
    writeFakeLinuxNw(t.old, 'A')
    fs.symlinkSync(path.join(t.toolkitRoot, 'missing'), t.shellApp)
    expect(validShellExists(t.shellApp)).toBe(false)
    expect(recoverOldIfNeeded(t.shellApp)).toBe(true)
    expect(fs.lstatSync(t.shellApp).isSymbolicLink()).toBe(false)
    expect(marker(t.shellApp)).toBe('A')
  })

  it('正式路径是残缺目录、.old 可用：残缺目录改名为 .broken 后恢复', () => {
    const t = setup()
    writeFakeLinuxNw(t.old, 'A')
    fs.mkdirSync(t.shellApp, { recursive: true })
    fs.writeFileSync(path.join(t.shellApp, 'half.txt'), '')
    expect(recoverOldIfNeeded(t.shellApp)).toBe(true)
    expect(marker(t.shellApp)).toBe('A')
    expect(fs.existsSync(path.join(t.broken, 'half.txt'))).toBe(true)
  })

  it('正式壳可用时不动 .old；两者都不可用时什么都不删', () => {
    const t = setup()
    writeFakeLinuxNw(t.shellApp, 'A')
    writeFakeLinuxNw(t.old, 'OLD')
    expect(recoverOldIfNeeded(t.shellApp)).toBe(false)
    expect(marker(t.old)).toBe('OLD')

    fs.rmSync(t.shellApp, { recursive: true })
    fs.rmSync(path.join(t.old, 'nw'))
    fs.mkdirSync(t.shellApp)
    expect(recoverOldIfNeeded(t.shellApp)).toBe(false)
    expect(fs.existsSync(t.shellApp)).toBe(true)
    expect(fs.existsSync(t.old)).toBe(true)
  })

  it('清理上次残留的 .staging', () => {
    const t = setup()
    fs.mkdirSync(path.join(t.staging, 'junk'), { recursive: true })
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    expect(fs.existsSync(t.staging)).toBe(false)
    expect(marker(t.shellApp)).toBe('A')
  })

  it('卸载同时删 .old，避免之后被恢复回来', () => {
    const t = setup()
    installShell({ shellSource: t.srcA, contentRoot: t.contentRoot, toolkitRoot: t.toolkitRoot })
    writeFakeLinuxNw(t.old, 'OLD')
    uninstallToolkitShell(t.toolkitRoot)
    expect(fs.existsSync(t.shellApp)).toBe(false)
    expect(fs.existsSync(t.old)).toBe(false)
    expect(recoverOldIfNeeded(t.shellApp)).toBe(false)
  })
})
