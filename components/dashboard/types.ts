import type { LibraryItemView } from '@/lib/game'

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

export type NwWindowConfig = {
  title: string
  width: number
  height: number
  resizable: boolean
  fullscreen: boolean
  frame: boolean
  toolbar: boolean
  show: boolean
  'always-on-top': boolean
  devtools: boolean
  position: string
  icon: string
  min_width: number | null
  min_height: number | null
  max_width: number | null
  max_height: number | null
}

type LibraryItem = LibraryItemView

export type Status =
  | {
      ready: false
      serviceMode?: 'local' | 'vercel' | 'app'
      canUseDisk?: boolean
      error?: string
      config?: { gameRoot: string; shellSource: string }
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
      config: { gameRoot: string; shellSource: string }
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
