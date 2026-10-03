import { topThirdPartyFamilies } from './plugins'
import type { GameFingerprint, GameFingerprintSummary, PackageInfo, SystemInfo } from './types'

export * from './engine'
export * from './plugins'
export * from './shell'
export type * from './types'

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** `data/System.json`；故意不读 encryptionKey */
export function parseSystemJson(raw: unknown): SystemInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const sys = raw as Record<string, unknown>
  const advanced = sys.advanced && typeof sys.advanced === 'object' ? (sys.advanced as Record<string, unknown>) : {}
  return {
    ...(str(sys.gameTitle) ? { gameTitle: str(sys.gameTitle) } : {}),
    ...(str(sys.locale) ? { locale: str(sys.locale) } : {}),
    ...(num(sys.versionId) != null ? { versionId: num(sys.versionId) } : {}),
    encryptedImages: sys.hasEncryptedImages === true,
    encryptedAudio: sys.hasEncryptedAudio === true,
    ...(num(advanced.screenWidth) != null ? { screenWidth: num(advanced.screenWidth) } : {}),
    ...(num(advanced.screenHeight) != null ? { screenHeight: num(advanced.screenHeight) } : {}),
  }
}

export function parsePackageJson(raw: unknown, file: string): PackageInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const pkg = raw as Record<string, unknown>
  const window = pkg.window && typeof pkg.window === 'object' ? (pkg.window as Record<string, unknown>) : {}
  return {
    file,
    ...(str(pkg.name) ? { name: str(pkg.name) } : {}),
    ...(str(pkg.main) ? { main: str(pkg.main) } : {}),
    ...(str(window.title) ? { title: str(window.title) } : {}),
    ...(num(window.width) != null ? { width: num(window.width) } : {}),
    ...(num(window.height) != null ? { height: num(window.height) } : {}),
    ...(str(pkg['chromium-args']) ? { chromiumArgs: str(pkg['chromium-args']) } : {}),
    ...(str(pkg['js-flags']) ? { jsFlags: str(pkg['js-flags']) } : {}),
  }
}

export function summarizeFingerprint(fingerprint: GameFingerprint): GameFingerprintSummary {
  const thirdParty = fingerprint.plugins.filter((plugin) => !plugin.chaya)
  return {
    engine: fingerprint.engine.name,
    engineVersion: fingerprint.engine.version,
    pluginCount: thirdParty.length,
    enabledPluginCount: thirdParty.filter((plugin) => plugin.enabled).length,
    topFamilies: topThirdPartyFamilies(fingerprint.pluginStats),
    encrypted: !!fingerprint.system && (fingerprint.system.encryptedImages || fingerprint.system.encryptedAudio),
  }
}
