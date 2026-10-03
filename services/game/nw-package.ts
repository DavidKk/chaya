import fs from 'node:fs'
import path from 'node:path'

import { mergeNwPackageWindow, normalizeWindow, type NwWindowConfig, sanitizeNwPackageName } from '@/lib/game/nw-window'

export { DEFAULT_WINDOW, normalizeWindow, type NwWindowConfig, sanitizeNwPackageName } from '@/lib/game/nw-window'

export type NwPackageInfo = {
  file: string
  name: string
  main: string
  window: NwWindowConfig
}

function packageJsonPath(contentRoot: string): string {
  return path.join(contentRoot, 'package.json')
}

function suggestNwPackageName(contentRoot: string, raw?: Record<string, unknown>): string {
  const win = raw?.window && typeof raw.window === 'object' ? (raw.window as Record<string, unknown>) : null
  const title = String(win?.title || '').trim()
  if (title) return sanitizeNwPackageName(title)

  const base = path.basename(path.resolve(contentRoot))
  if (base.toLowerCase() === 'www' || base.toLowerCase() === 'app.nw' || base.toLowerCase() === 'package.nw') {
    return sanitizeNwPackageName(path.basename(path.dirname(path.resolve(contentRoot))), 'game')
  }
  return sanitizeNwPackageName(base, 'game')
}

/**
 * 启动前保证 package.json 的 name 合法（空字符串会导致 NW 报 Required value 'name' is missing or invalid）。
 * 已合法则不写盘。
 */
export function ensureNwPackageName(contentRoot: string): { file: string; name: string; updated: boolean } {
  const root = path.resolve(contentRoot)
  const file = packageJsonPath(root)
  if (!fs.existsSync(file)) {
    const name = suggestNwPackageName(root)
    const raw = { name, main: 'index.html', window: { title: name } }
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return { file, name, updated: true }
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    throw new Error(`无法解析 package.json: ${file}`)
  }

  const current = String(raw.name ?? '').trim()
  if (current && sanitizeNwPackageName(current) === current) {
    return { file, name: current, updated: false }
  }

  const name = current ? sanitizeNwPackageName(current, suggestNwPackageName(root, raw)) : suggestNwPackageName(root, raw)
  raw.name = name
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
  fs.renameSync(tmp, file)
  return { file, name, updated: true }
}

export function readNwPackage(contentRoot: string): NwPackageInfo | null {
  const file = packageJsonPath(contentRoot)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    return {
      file,
      name: String(raw.name || ''),
      main: String(raw.main || 'index.html'),
      window: normalizeWindow(raw.window),
    }
  } catch {
    return null
  }
}

/** 合并写入 window；保留 package.json 其它字段 */
export function writeNwWindow(contentRoot: string, partial: Partial<NwWindowConfig>): NwPackageInfo {
  const file = packageJsonPath(contentRoot)
  let raw: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } else {
    raw = { name: suggestNwPackageName(contentRoot), main: 'index.html' }
  }

  raw = mergeNwPackageWindow(raw, partial, suggestNwPackageName(contentRoot, raw))
  const nextWindow = raw.window as NwWindowConfig

  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
  fs.renameSync(tmp, file)

  return {
    file,
    name: String(raw.name || ''),
    main: String(raw.main || 'index.html'),
    window: nextWindow,
  }
}
