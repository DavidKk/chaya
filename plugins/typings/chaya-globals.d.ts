/**
 * Plugin globals — NW.js / RPG Maker MV·MZ runtime (trimmed)
 */

import type { ChayaLogApi } from '../src/helpers/net/logger'

export {}

declare const __CHAYA_PLUGINS_DEV__: boolean | undefined

type ChayaTransStatus = {
  file: string
  entries: number
  kind: 'ndjson' | 'json'
  remoteOnline: boolean | null
  translating: boolean
  playMode: 'pretranslated' | 'realtime' | 'subtitle'
}

type ChayaTransApi = {
  translate: (s: string, enqueue?: boolean) => string
  reload: () => boolean
  status: () => ChayaTransStatus
  readonly raw: Record<string, string>
  readonly source: string
  readonly count: number
}

type RmEventCommand = {
  code?: number
  parameters?: unknown[]
  indent?: number
}

type RmDataRow = Record<string, unknown> & {
  id?: number
  name?: string
  nickname?: string
  description?: string
  profile?: string
  message1?: string
  message2?: string
  message3?: string
  message4?: string
  list?: RmEventCommand[]
  pages?: Array<{ list?: RmEventCommand[] }>
}

type RmSystemTerms = {
  basic?: string[]
  commands?: string[]
  params?: string[]
  messages?: Record<string, string>
}

type RmSystem = {
  gameTitle?: string
  currencyUnit?: string
  terms?: RmSystemTerms
  elements?: string[]
  skillTypes?: string[]
  weaponTypes?: string[]
  armorTypes?: string[]
  equipTypes?: string[]
  switches?: unknown[]
  variables?: unknown[]
  [key: string]: unknown
}

type RmMap = {
  displayName?: string
  events?: Array<RmDataRow | null>
}

declare global {
  interface Window {
    ChayaLog: ChayaLogApi
    Chaya: {
      log: ChayaLogApi
      fetch: (pathOrUrl: string, init?: RequestInit) => Promise<Response>
      postJson: (pathOrUrl: string, data: unknown) => Promise<Response>
      apiBase: () => string
      logUrl: () => string
    }
    /** In-game translation plugin API (PLUGIN_TRANS_NAME = ChayaTrans) */
    ChayaTrans?: ChayaTransApi
    /** In-game speed boost (PLUGIN_BOOST_NAME) */
    ChayaBoost: {
      on: (rate?: number) => unknown
      off: () => unknown
      rate: (n: number) => unknown
      walkRate: (n?: number) => unknown
      runRate: (n?: number) => unknown
      rates: (opts?: { walk?: number; run?: number }) => unknown
      speed: (n?: number) => unknown
      dash: (on?: boolean) => unknown
      status: () => { walk: number; run: number; moveRate: number | null; gameSpeed: number; alwaysDash: boolean }
    }
    /** In-game edit panel (PLUGIN_EDIT_NAME); short alias `ge` */
    ChayaEdit: any
    ge: any
    boostOn: (rate?: number) => unknown
    boostOff: () => unknown
    CHAYA_LOG_URL?: string
    CHAYA_API_BASE?: string
    /** Local launch auth; sent with heartbeat; no token → no game-DB writes */
    CHAYA_LAUNCH_TOKEN?: string
    CHAYA_GAME_ID?: string
    /** @deprecated Use window.ChayaTrans */
    _chayaTranslate?: (s: string, enqueue?: boolean) => string
    /** @deprecated Use window.ChayaTrans */
    _chayaTransReload?: () => boolean
    /** @deprecated Use window.ChayaTrans */
    _chayaTransStatus?: () => ChayaTransStatus
    _chayaTransRaw?: Record<string, string>
    _chayaTransSource?: string
    _chayaTransCount?: number
    /** ChayaEdit IIFE HMR: tear down React root + hotkeys; returns whether panel was open */
    __chayaGameEditDispose?: { dispose: () => boolean }
  }

  /* —— RPG Maker database / scenes —— */
  var $dataActors: Array<RmDataRow | null>
  var $dataClasses: Array<RmDataRow | null>
  var $dataSkills: Array<RmDataRow | null>
  var $dataItems: Array<RmDataRow | null>
  var $dataWeapons: Array<RmDataRow | null>
  var $dataArmors: Array<RmDataRow | null>
  var $dataEnemies: Array<RmDataRow | null>
  var $dataStates: Array<RmDataRow | null>
  var $dataTroops: Array<RmDataRow | null>
  var $dataAnimations: Array<RmDataRow | null>
  var $dataTilesets: Array<RmDataRow | null>
  var $dataCommonEvents: Array<RmDataRow | null>
  var $dataSystem: RmSystem
  var $dataMap: RmMap | null
  var $gameParty: any
  var $gameActors: any
  var $gameMessage: any
  var $gamePlayer: any
  var $gameSystem: any
  var $gameVariables: any
  var $gameSwitches: any
  var $gameMap: any

  var DataManager: {
    isDatabaseLoaded: () => boolean
    onLoad: (object: unknown) => void
    _chayaTransDbPatched?: boolean
    [key: string]: unknown
  }

  var SceneManager: any
  var ConfigManager: any
  var Input: any

  var Window_Base: any
  var Window_Message: any
  var Window_ChoiceList: any
  var Window_ScrollText: any
  var Bitmap: any
  var Game_Message: any
  var Graphics: { boxWidth: number; boxHeight: number }

  var PluginManager: { setParameters?: (name: string, params: Record<string, string>) => void } | undefined

  /* —— NW.js / Node sidecar (in-game require('fs')) —— */

  var process: NodeJS.Process

  var Buffer: typeof import('buffer').Buffer
  function require(id: string): any
}
