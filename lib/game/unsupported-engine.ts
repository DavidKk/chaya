/** Detect legacy RPG Maker engines from file names. VX/VX Ace are now supported for offline operations. */

export const UNSUPPORTED_ENGINE_CODE = 'UNSUPPORTED_ENGINE'

export type UnsupportedEngine = 'RPG Maker VX Ace' | 'RPG Maker VX' | 'RPG Maker XP' | 'RPG Maker 2000/2003' | 'Unity'

export type RgssEngine = 'RPG Maker VX Ace' | 'RPG Maker VX'

/** File names under the game root, `Data/` and `System/` */
export type EngineDirListing = {
  root: readonly string[]
  data?: readonly string[]
  system?: readonly string[]
}

const RGSS_ENGINES: Record<string, UnsupportedEngine> = { '1': 'RPG Maker XP', '2': 'RPG Maker VX', '3': 'RPG Maker VX Ace' }
const RGSS_ARCHIVES: Record<string, UnsupportedEngine> = { 'game.rgssad': 'RPG Maker XP', 'game.rgss2a': 'RPG Maker VX', 'game.rgss3a': 'RPG Maker VX Ace' }
const RGSS_DATA_EXTS: Record<string, UnsupportedEngine> = { '.rxdata': 'RPG Maker XP', '.rvdata': 'RPG Maker VX', '.rvdata2': 'RPG Maker VX Ace' }
const RGSS_DLL_RE = /^rgss([123])\d*[a-z]?\.dll$/
const UNITY_FILES = new Set(['unityplayer.dll', 'unitycrashhandler64.exe', 'unitycrashhandler32.exe', 'unityplayer.dylib'])

const lower = (names: readonly string[] | undefined) => (names ?? []).map((name) => name.toLowerCase())

export function detectRgssEngine(listing: EngineDirListing): RgssEngine | null {
  const root = lower(listing.root)
  const data = lower(listing.data)
  if (root.includes('game.rgss3a') || root.some((name) => RGSS_DLL_RE.test(name) && /^rgss3/.test(name)) || data.some((name) => name.endsWith('.rvdata2'))) {
    return 'RPG Maker VX Ace'
  }
  if (root.includes('game.rgss2a') || root.some((name) => RGSS_DLL_RE.test(name) && /^rgss2/.test(name)) || data.some((name) => name.endsWith('.rvdata'))) {
    return 'RPG Maker VX'
  }
  return null
}

export function detectUnsupportedEngine(listing: EngineDirListing): UnsupportedEngine | null {
  const root = lower(listing.root)
  for (const name of root) if (RGSS_ARCHIVES[name]) return RGSS_ARCHIVES[name]
  for (const name of [...root, ...lower(listing.system)]) {
    const rgss = RGSS_DLL_RE.exec(name)
    if (rgss) return RGSS_ENGINES[rgss[1]]
  }
  for (const name of lower(listing.data)) {
    const ext = name.slice(name.lastIndexOf('.'))
    if (RGSS_DATA_EXTS[ext]) return RGSS_DATA_EXTS[ext]
  }
  if (root.includes('rpg_rt.ldb') || root.includes('rpg_rt.lmt')) return 'RPG Maker 2000/2003'
  if (root.some((name) => UNITY_FILES.has(name))) return 'Unity'
  return null
}

export function unsupportedEngineMessage(engine: UnsupportedEngine): string {
  return `不支持该引擎（${engine}）。目前支持 RPG Maker MV / MZ，以及 VX Ace / VX 的离线数据翻译`
}

/** Read the unsupported engine name from an API error body */
export function readUnsupportedEngine(data: unknown): UnsupportedEngine | null {
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : null
  if (!error || typeof error !== 'object') return null
  const { code, engine } = error as { code?: unknown; engine?: unknown }
  return code === UNSUPPORTED_ENGINE_CODE && typeof engine === 'string' && engine ? (engine as UnsupportedEngine) : null
}

export class UnsupportedEngineError extends Error {
  readonly engine: UnsupportedEngine
  constructor(engine: UnsupportedEngine) {
    super(unsupportedEngineMessage(engine))
    this.name = 'UnsupportedEngineError'
    this.engine = engine
  }
}
