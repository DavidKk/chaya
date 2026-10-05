import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'
import sharp from 'sharp'

import { ensureGameAppIcon, updateSharedMacAppIcon } from '@/services/game/app-icon'

jest.mock('@/constants/paths', () => ({ ROOT_PATH: process.cwd() }))

const roots: string[] = []

function gameRoot(window: Record<string, unknown> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-app-icon-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test', main: 'index.html', window }))
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('ensureGameAppIcon', () => {
  it('combines a game icon with Chaya and remembers the original across launches', async () => {
    const root = gameRoot({ title: 'Game', icon: 'img/icon.png' })
    fs.mkdirSync(path.join(root, 'img'))
    fs.writeFileSync(
      path.join(root, 'img/icon.png'),
      await sharp({ create: { width: 512, height: 512, channels: 4, background: '#e42323' } })
        .png()
        .toBuffer()
    )

    expect(await ensureGameAppIcon(root)).toEqual({ icon: 'chaya/app-icon.png', source: 'game+chaya' })
    const first = fs.readFileSync(path.join(root, 'chaya/app-icon.png'))
    expect(await ensureGameAppIcon(root)).toEqual({ icon: 'chaya/app-icon.png', source: 'game+chaya' })
    expect(fs.readFileSync(path.join(root, 'chaya/app-icon.png'))).toEqual(first)
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(manifest.window).toEqual({ title: 'Game', icon: 'chaya/app-icon.png' })
    const pixel = await sharp(first).extract({ left: 470, top: 470, width: 1, height: 1 }).raw().toBuffer()
    expect(pixel[0]).not.toBe(228)
  })

  it('uses Chaya when the game has no icon', async () => {
    const root = gameRoot({ title: 'No Icon' })
    expect(await ensureGameAppIcon(root)).toEqual({ icon: 'chaya/app-icon.png', source: 'chaya' })
    expect(await sharp(path.join(root, 'chaya/app-icon.png')).metadata()).toMatchObject({ width: 512, height: 512 })
  })

  it('migrates the hidden path without treating its generated image as the game logo', async () => {
    const root = gameRoot({ icon: '.chaya/app-icon.png' })
    fs.mkdirSync(path.join(root, '.chaya'))
    fs.writeFileSync(path.join(root, '.chaya/app-icon-source.json'), '{"source":""}')
    expect(await ensureGameAppIcon(root)).toEqual({ icon: 'chaya/app-icon.png', source: 'chaya' })
  })

  it('ignores icon paths outside the game', async () => {
    const root = gameRoot({ icon: '../private.png' })
    expect((await ensureGameAppIcon(root)).source).toBe('chaya')
  })

  it('falls back to Chaya for an unreadable game image', async () => {
    const root = gameRoot({ icon: 'icon.png' })
    fs.writeFileSync(path.join(root, 'icon.png'), 'not an image')
    expect((await ensureGameAppIcon(root)).source).toBe('chaya')
  })

  if (process.platform === 'darwin') {
    it('updates the icon resource used by a shared macOS app bundle', async () => {
      const root = gameRoot()
      const shell = path.join(root, 'Chaya.app')
      const resources = path.join(shell, 'Contents/Resources')
      fs.mkdirSync(resources, { recursive: true })
      fs.writeFileSync(
        path.join(shell, 'Contents/Info.plist'),
        '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIconFile</key><string>app.icns</string></dict></plist>'
      )
      const icon = await ensureGameAppIcon(root)
      await updateSharedMacAppIcon(shell, root, icon.icon)
      expect(fs.readFileSync(path.join(resources, 'Chaya.icns')).subarray(0, 4).toString()).toBe('icns')
      expect(fs.readFileSync(path.join(shell, 'Contents/Info.plist'), 'utf8')).toContain('app.chaya.game-shell')
    })
  }
})
