import type { EngineInfo, EngineLib, EngineName, EngineSource } from './types'

const CORE_FILES: Record<Exclude<EngineName, 'unknown'>, readonly string[]> = {
  MZ: ['rmmz_core.js', 'rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js'],
  MV: ['rpg_core.js', 'rpg_managers.js', 'rpg_objects.js', 'rpg_scenes.js', 'rpg_sprites.js', 'rpg_windows.js'],
}

/** 优先读来定版本的核心文件 */
export const ENGINE_CORE_CANDIDATES = ['rmmz_core.js', 'rpg_core.js'] as const

const NAME_RE = /Utils\.RPGMAKER_NAME\s*=\s*['"](\w+)['"]/
const VERSION_RE = /Utils\.RPGMAKER_VERSION\s*=\s*['"](\d+(?:\.\d+)+)['"]/
const HEADER_RE = /\b(rmmz|rpg)_core\.js\s+v?(\d+(?:\.\d+)+)/
const LIB_VERSION_RE = /\bv?(\d+\.\d+\.\d+)\b/

function toEngineName(raw: string | undefined): EngineName {
  const name = String(raw || '').toUpperCase()
  return name === 'MZ' || name === 'MV' ? name : 'unknown'
}

/** 从核心脚本（或打包后的单文件脚本）读引擎名与版本 */
export function parseCoreScript(source: string): { name: EngineName; version: string | null; source: EngineSource } {
  const name = toEngineName(NAME_RE.exec(source)?.[1])
  const version = VERSION_RE.exec(source)?.[1] ?? null
  if (name !== 'unknown' || version) return { name, version, source: 'constant' }
  const header = HEADER_RE.exec(source)
  if (header) return { name: header[1] === 'rmmz' ? 'MZ' : 'MV', version: header[2] ?? null, source: 'header' }
  return { name: 'unknown', version: null, source: 'none' }
}

/** 第三方库文件头里的版本号，如 `pixi.js - v5.3.12` */
export function parseLibVersion(head: string): string | null {
  return LIB_VERSION_RE.exec(head.slice(0, 600))?.[1] ?? null
}

export function engineFromFiles(jsFiles: readonly string[]): { name: EngineName; coreFiles: string[] } {
  const lower = new Set(jsFiles.map((file) => file.toLowerCase()))
  for (const name of ['MZ', 'MV'] as const) {
    const coreFiles = CORE_FILES[name].filter((file) => lower.has(file))
    if (coreFiles.length) return { name, coreFiles }
  }
  return { name: 'unknown', coreFiles: [] }
}

export function detectEngine(input: { jsFiles: readonly string[]; coreSource?: string | null; libs?: EngineLib[] }): EngineInfo {
  const files = engineFromFiles(input.jsFiles)
  const parsed = input.coreSource ? parseCoreScript(input.coreSource) : null
  const libs = input.libs ?? []
  if (parsed && parsed.source !== 'none') {
    return { name: parsed.name !== 'unknown' ? parsed.name : files.name, version: parsed.version, source: parsed.source, coreFiles: files.coreFiles, libs }
  }
  if (files.name !== 'unknown') return { name: files.name, version: null, source: 'files', coreFiles: files.coreFiles, libs }
  // 核心脚本被合并 / 混淆：MZ 自带 effekseer，PIXI 大版本也不同（MV 4.x，MZ 5.x）
  const pixiMajor = Number(libs.find((lib) => /^pixi/i.test(lib.name))?.version?.split('.')[0])
  const effekseer = libs.some((lib) => /^effekseer/i.test(lib.name))
  const name: EngineName = effekseer || pixiMajor >= 5 ? 'MZ' : pixiMajor === 4 ? 'MV' : 'unknown'
  return { name, version: null, source: name === 'unknown' ? 'none' : 'files', coreFiles: [], libs }
}
