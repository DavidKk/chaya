import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import sharp from 'sharp'

import { ROOT_PATH } from '@/constants/paths'

const GENERATED_ICON = 'chaya/app-icon.png'
const SOURCE_FILE = 'chaya/app-icon-source.json'
const LEGACY_GENERATED_ICON = '.chaya/app-icon.png'
const LEGACY_SOURCE_FILE = '.chaya/app-icon-source.json'
const BRAND_ICON = path.join(ROOT_PATH, 'public/brand/chaya-app-icon.png')
const COMMON_ICONS = ['icon.png', 'icon.jpg', 'icon.jpeg', 'img/icon.png', 'img/icons/icon.png', 'favicon.png', 'favicon.ico']
const ICON_SIZE = 512
const execFileAsync = promisify(execFile)

function localIcon(contentRoot: string, value: string): string | null {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return null
  const root = path.resolve(contentRoot)
  const file = path.resolve(root, value.replace(/\\/g, '/'))
  if (!file.startsWith(`${root}${path.sep}`)) return null
  try {
    const real = fs.realpathSync(file)
    return real.startsWith(`${fs.realpathSync(root)}${path.sep}`) && fs.statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

function embeddedIcoPng(file: string): Buffer | null | undefined {
  const ico = fs.readFileSync(file)
  if (ico.length < 22 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) === 0) return undefined
  const count = Math.min(ico.readUInt16LE(4), 128)
  let best: { size: number; data: Buffer } | null = null
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    if (offset + 16 > ico.length) break
    const size = ico.readUInt32LE(offset + 8)
    const start = ico.readUInt32LE(offset + 12)
    if (start + size > ico.length || size < 8 || !ico.subarray(start, start + 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) continue
    const width = ico[offset] || 256
    if (!best || width > best.size) best = { size: width, data: ico.subarray(start, start + size) }
  }
  return best?.data ?? null
}

function readOriginalSource(contentRoot: string, icon: string): string {
  if (icon !== GENERATED_ICON && icon !== LEGACY_GENERATED_ICON) return icon
  try {
    const file = icon === LEGACY_GENERATED_ICON ? LEGACY_SOURCE_FILE : SOURCE_FILE
    const saved = JSON.parse(fs.readFileSync(path.join(contentRoot, file), 'utf8')) as { source?: unknown }
    return typeof saved.source === 'string' ? saved.source : ''
  } catch {
    return ''
  }
}

/** Set the NW window/taskbar icon for the selected game without changing its other manifest fields. */
export async function ensureGameAppIcon(contentRoot: string): Promise<{ icon: string; source: 'game+chaya' | 'game' | 'chaya' }> {
  const manifest = path.join(contentRoot, 'package.json')
  const raw = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>
  const window = raw.window && typeof raw.window === 'object' && !Array.isArray(raw.window) ? (raw.window as Record<string, unknown>) : {}
  const original = readOriginalSource(contentRoot, typeof window.icon === 'string' ? window.icon : '')
  const candidates = [...new Set([original, ...COMMON_ICONS])]
  let gameIcon: string | null = null
  let gameBytes: Buffer | null = null

  for (const candidate of candidates) {
    const file = localIcon(contentRoot, candidate)
    if (!file) continue
    const bytes = path.extname(file).toLowerCase() === '.ico' ? embeddedIcoPng(file) : fs.readFileSync(file)
    if (bytes === null) {
      if (!gameIcon) gameIcon = candidate
      continue
    }
    if (!bytes) continue
    try {
      const meta = await sharp(bytes).metadata()
      if (!meta.width || !meta.height || meta.width > 8192 || meta.height > 8192) continue
      gameIcon = candidate
      gameBytes = bytes
      break
    } catch {}
  }

  if (gameIcon && !gameBytes) {
    if (window.icon !== gameIcon) {
      window.icon = gameIcon
      raw.window = window
      fs.writeFileSync(manifest, `${JSON.stringify(raw, null, 2)}\n`)
    }
    return { icon: gameIcon, source: 'game' }
  }

  const base = gameBytes ?? fs.readFileSync(BRAND_ICON)
  const basePng = await sharp(base).resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: '#00000000' }).png().toBuffer()
  let output = basePng
  if (gameBytes) {
    const badgeSize = 176
    const badge = await sharp(BRAND_ICON).resize(badgeSize, badgeSize, { fit: 'contain' }).png().toBuffer()
    output = await sharp(basePng)
      .composite([{ input: badge, left: ICON_SIZE - badgeSize - 8, top: ICON_SIZE - badgeSize - 8 }])
      .png()
      .toBuffer()
  }

  const generated = path.join(contentRoot, GENERATED_ICON)
  fs.mkdirSync(path.dirname(generated), { recursive: true })
  fs.writeFileSync(generated, output)
  fs.writeFileSync(path.join(contentRoot, SOURCE_FILE), `${JSON.stringify({ source: gameIcon || '' })}\n`)
  if (window.icon !== GENERATED_ICON) {
    window.icon = GENERATED_ICON
    raw.window = window
    fs.writeFileSync(manifest, `${JSON.stringify(raw, null, 2)}\n`)
  }
  return { icon: GENERATED_ICON, source: gameBytes ? 'game+chaya' : 'chaya' }
}

/** macOS gets its Dock/Finder image from the shared .app bundle, not NW's window.icon. */
export async function updateSharedMacAppIcon(shellApp: string, contentRoot: string, icon: string): Promise<void> {
  if (process.platform !== 'darwin') return
  const source = localIcon(contentRoot, icon)
  if (!source) return
  const info = path.join(shellApp, 'Contents/Info.plist')
  const resources = path.join(shellApp, 'Contents/Resources')
  const target = path.join(resources, 'Chaya.icns')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-icon-'))
  const iconset = path.join(work, 'Chaya.iconset')
  fs.mkdirSync(iconset)
  try {
    let input = source
    try {
      await sharp(source).metadata()
    } catch {
      input = path.join(work, 'source.png')
      await execFileAsync('sips', ['-s', 'format', 'png', source, '--out', input])
    }
    const sizes = [16, 32, 64, 128, 256, 512] as const
    for (const size of sizes) {
      await sharp(input)
        .resize(size, size, { fit: 'contain', background: '#00000000' })
        .png()
        .toFile(path.join(iconset, `icon_${size}x${size}.png`))
      if (size !== 512) {
        await sharp(input)
          .resize(size * 2, size * 2, { fit: 'contain', background: '#00000000' })
          .png()
          .toFile(path.join(iconset, `icon_${size}x${size}@2x.png`))
      }
    }
    await sharp(input).resize(1024, 1024, { fit: 'contain', background: '#00000000' }).png().toFile(path.join(iconset, 'icon_512x512@2x.png'))
    const output = path.join(work, 'Chaya.icns')
    await execFileAsync('iconutil', ['-c', 'icns', iconset, '-o', output])
    fs.copyFileSync(output, target)
    await execFileAsync('plutil', ['-replace', 'CFBundleIconFile', '-string', 'Chaya.icns', info])
    await execFileAsync('plutil', ['-replace', 'CFBundleIdentifier', '-string', 'app.chaya.game-shell', info])
    await execFileAsync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'Chaya', info])
    await execFileAsync('plutil', ['-replace', 'CFBundleName', '-string', 'Chaya', info])
    const now = new Date()
    fs.utimesSync(shellApp, now, now)
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    if (fs.existsSync(lsregister)) await execFileAsync(lsregister, ['-f', shellApp])
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
