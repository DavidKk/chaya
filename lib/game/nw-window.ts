/** NW.js package.json → window 常用字段；纯逻辑，服务端（fs）与浏览器（FSA）共用 */
export type NwWindowConfig = {
  title: string
  position: string
  show: boolean
  toolbar: boolean
  icon: string
  width: number
  height: number
  min_width: number | null
  min_height: number | null
  max_width: number | null
  max_height: number | null
  resizable: boolean
  fullscreen: boolean
  frame: boolean
  'always-on-top': boolean
  devtools: boolean
}

export const DEFAULT_WINDOW: NwWindowConfig = {
  title: '',
  position: 'center',
  show: true,
  toolbar: false,
  icon: '',
  width: 816,
  height: 624,
  min_width: 408,
  min_height: 312,
  max_width: null,
  max_height: null,
  resizable: true,
  fullscreen: false,
  frame: true,
  'always-on-top': false,
  devtools: false,
}

function asNum(v: unknown, fallback: number | null): number | null {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  return fallback
}

export function normalizeWindow(raw: unknown): NwWindowConfig {
  const w = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    title: String(w.title ?? DEFAULT_WINDOW.title),
    position: String(w.position ?? DEFAULT_WINDOW.position),
    show: asBool(w.show, DEFAULT_WINDOW.show),
    toolbar: asBool(w.toolbar, DEFAULT_WINDOW.toolbar),
    icon: String(w.icon ?? DEFAULT_WINDOW.icon),
    width: asNum(w.width, DEFAULT_WINDOW.width) ?? DEFAULT_WINDOW.width,
    height: asNum(w.height, DEFAULT_WINDOW.height) ?? DEFAULT_WINDOW.height,
    min_width: asNum(w.min_width, DEFAULT_WINDOW.min_width),
    min_height: asNum(w.min_height, DEFAULT_WINDOW.min_height),
    max_width: asNum(w.max_width, DEFAULT_WINDOW.max_width),
    max_height: asNum(w.max_height, DEFAULT_WINDOW.max_height),
    resizable: asBool(w.resizable, DEFAULT_WINDOW.resizable),
    fullscreen: asBool(w.fullscreen, DEFAULT_WINDOW.fullscreen),
    frame: asBool(w.frame, DEFAULT_WINDOW.frame),
    'always-on-top': asBool(w['always-on-top'], DEFAULT_WINDOW['always-on-top']),
    devtools: asBool(w.devtools, DEFAULT_WINDOW.devtools),
  }
}

/** NW.js / Chromium 要求 name 非空；部分游戏发布时写成 "" */
export function sanitizeNwPackageName(raw: string, fallback = 'game'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return cleaned || fallback
}

const GENERIC_PACKAGE_NAMES = new Set(['rmmv-game-data', 'game', 'www', 'app', 'rpgmaker', 'game-data', 'unnamed'])

/**
 * 游戏展示名（server / 浏览器同规则）：
 * 1. window.title（若非空）
 * 2. System.json 的 gameTitle（若有）
 * 3. package.json 的 name（非 rmmv-game-data / game 等模板占位名）
 * 4. 目录名 / 兜底
 */
export function nwGameDisplayName(pkg: { name?: string; window?: { title?: string } } | null | undefined, folder: string, extra?: { gameTitle?: string | null }): string {
  const windowTitle = pkg?.window?.title?.trim()
  if (windowTitle) return windowTitle

  const systemGameTitle = extra?.gameTitle?.trim()
  if (systemGameTitle) return systemGameTitle

  const pkgName = pkg?.name?.trim()
  if (pkgName && !GENERIC_PACKAGE_NAMES.has(pkgName.toLowerCase())) {
    return pkgName
  }

  const base = folder.replace(/\.app$/i, '') || folder
  return base || '未命名游戏'
}

/** 合并写入 window 并修正 name；保留 package.json 其它字段与键顺序 */
export function mergeNwPackageWindow(raw: Record<string, unknown>, partial: Partial<NwWindowConfig>, fallbackName: string): Record<string, unknown> {
  const name = String(raw.name || '').trim()
  return {
    ...raw,
    name: name ? sanitizeNwPackageName(name, fallbackName) : fallbackName,
    window: normalizeWindow({ ...normalizeWindow(raw.window), ...partial }),
  }
}
