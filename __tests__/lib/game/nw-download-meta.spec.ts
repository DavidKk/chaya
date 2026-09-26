import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'

import { normalizeNwVersion, nwArchiveName, nwDownloadUrl, nwFileKey } from '@/lib/game/nw-download-meta'
import { findShellSourceInExtract } from '@/services/game/nw-download'

describe('nw-download-meta', () => {
  it('映射平台与架构到 versions.json files 键', () => {
    expect(nwFileKey('win32', 'x64')).toBe('win-x64')
    expect(nwFileKey('win32', 'arm64')).toBe('win-arm64')
    expect(nwFileKey('darwin', 'arm64')).toBe('osx-arm64')
    expect(nwFileKey('darwin', 'x64')).toBe('osx-x64')
    expect(nwFileKey('linux', 'x64')).toBe('linux-x64')
  })

  it('拼下载 URL', () => {
    expect(normalizeNwVersion('0.116.0')).toBe('v0.116.0')
    expect(nwArchiveName('v0.116.0', 'win-x64')).toBe('nwjs-v0.116.0-win-x64.zip')
    expect(nwArchiveName('v0.116.0', 'linux-x64')).toBe('nwjs-v0.116.0-linux-x64.tar.gz')
    expect(nwDownloadUrl('v0.116.0', 'osx-arm64')).toBe('https://dl.nwjs.io/v0.116.0/nwjs-v0.116.0-osx-arm64.zip')
  })
})

describe('findShellSourceInExtract', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('识别解压后的 macOS .app', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-extract-'))
    dirs.push(root)
    const app = path.join(root, 'nwjs.app')
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'nwjs'), 'x')
    expect(findShellSourceInExtract(root)).toBe(app)
  })

  it('识别解压后一层目录内的 nw.exe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-extract-'))
    dirs.push(root)
    const pack = path.join(root, 'nwjs-v0.116.0-win-x64')
    fs.mkdirSync(pack, { recursive: true })
    fs.writeFileSync(path.join(pack, 'nw.exe'), 'x')
    expect(findShellSourceInExtract(root)).toBe(pack)
  })
})
