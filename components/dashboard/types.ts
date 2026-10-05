import type { LibraryItemView } from '@/lib/game'
import type { NwWindowConfig } from '@/lib/game/nw-window'

export function rootsEqual(a: string, b: string) {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '')
}

export function libraryIdForRoot(library: LibraryItemView[], gameRoot: string): string | null {
  const hit = library.find((item) => rootsEqual(item.gameRoot, gameRoot))
  return hit?.id ?? null
}

type PluginStatus = {
  name: string
  registered: boolean
  enabled: boolean
  fileExists: boolean
}

export type { NwWindowConfig } from '@/lib/game/nw-window'

type LibraryItem = LibraryItemView

export type Status =
  | {
      ready: false
      serviceMode?: 'local' | 'vercel' | 'app'
      canUseDisk?: boolean
      error?: string
      config?: { gameRoot: string; shellSource: string; shellSourceValid?: boolean }
      library?: LibraryItem[]
      heal?: { pruned?: string[]; switchedTo?: string | null; message?: string }
      runtime?: {
        gameOnline: boolean
        apiBase?: string
        lanBases?: string[]
      }
    }
  | {
      ready: true
      serviceMode?: 'local' | 'vercel' | 'app'
      canUseDisk?: boolean
      remote?: boolean
      config: { gameRoot: string; shellSource: string; shellSourceValid?: boolean }
      library?: LibraryItem[]
      heal?: { pruned?: string[]; switchedTo?: string | null; message?: string }
      contentRoot: string
      projectRoot: string
      kind: string
      hasShell: boolean
      bundled: boolean
      /** 工具目录里用户安装的共用壳，可卸载 */
      installedShell?: boolean
      nestedInApp: boolean
      shellApp?: string
      footprint?: {
        contentBytes: number | null
        contentLabel: string | null
        shellBytes: number | null
        shellLabel: string | null
      }
      cache: { entries: number }
      sharedCache?: { entries: number }
      plugins: PluginStatus[]
      pluginsReady?: number
      pluginsTotal?: number
      /** Installed, but the game's plugin files differ from the current build */
      pluginsOutdated?: boolean
      nwPackage?: { name?: string; window: NwWindowConfig } | null
      runtime?: {
        gameOnline: boolean
        apiBase?: string
        lanBases?: string[]
      }
      host?: {
        platform?: string
        shellPath?: string
        shellKind?: string
      }
    }
