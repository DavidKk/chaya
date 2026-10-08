/**
 * Runtime page extras: system toggles, scene jumps, battle shortcuts, click teleport, soft-skip asset errors
 */

import { readCachedToolSettings, TOOL_SETTINGS_EVENT, TOOL_SETTINGS_STORAGE_KEY, type ToolSettings } from '@/lib/game-agent/tool-settings'

import { createLogger } from '../../helpers/net/logger'
import { gameMap, gameMessage, gamePlayer, gameScreen, gameTroop } from './game-globals'
import { installSmartPath } from './smart-path'

export type ScenePushId = 'status' | 'equip' | 'skill' | 'item' | 'menu' | 'load' | 'save' | 'options' | 'debug'

const SCENE_MAP: Record<ScenePushId, () => unknown> = {
  status: () => (typeof Scene_Status !== 'undefined' ? Scene_Status : null),
  equip: () => (typeof Scene_Equip !== 'undefined' ? Scene_Equip : null),
  skill: () => (typeof Scene_Skill !== 'undefined' ? Scene_Skill : null),
  item: () => (typeof Scene_Item !== 'undefined' ? Scene_Item : null),
  menu: () => (typeof Scene_Menu !== 'undefined' ? Scene_Menu : null),
  load: () => (typeof Scene_Load !== 'undefined' ? Scene_Load : null),
  save: () => (typeof Scene_Save !== 'undefined' ? Scene_Save : null),
  options: () => (typeof Scene_Options !== 'undefined' ? Scene_Options : null),
  debug: () => (typeof Scene_Debug !== 'undefined' ? Scene_Debug : null),
}

type RunFlags = {
  clickMove: boolean
  clickTeleport: boolean
  expRate: number
  resourceSkip: boolean
}

const FLAGS_KEY = '__chayaRunCheatsFlags_v1__'
const HOOK_KEY = '__chayaRunCheatsHooks_v1__'

function flags(): RunFlags {
  const g = globalThis as typeof globalThis & { [FLAGS_KEY]?: RunFlags }
  if (!g[FLAGS_KEY]) {
    g[FLAGS_KEY] = { clickMove: true, clickTeleport: false, expRate: 1, resourceSkip: false }
  }
  return g[FLAGS_KEY]
}

function hooks() {
  const g = globalThis as typeof globalThis & { [HOOK_KEY]?: { touch?: boolean; exp?: boolean; resource?: boolean } }
  if (!g[HOOK_KEY]) g[HOOK_KEY] = {}
  return g[HOOK_KEY]
}

function sys(): any {
  return typeof $gameSystem !== 'undefined' ? $gameSystem : null
}

function ensureTouchHook() {
  const h = hooks()
  if (h.touch) return
  if (typeof Game_Temp === 'undefined' || !Game_Temp?.prototype?.setDestination) return
  h.touch = true
  const _set = Game_Temp.prototype.setDestination
  Game_Temp.prototype.setDestination = function (x: number, y: number) {
    const f = flags()
    if (f.clickTeleport && gamePlayer() && typeof gamePlayer().locate === 'function') {
      try {
        gamePlayer().locate(Math.floor(x), Math.floor(y))
        if (typeof this.clearDestination === 'function') this.clearDestination()
      } catch {
        /* */
      }
      return
    }
    if (!f.clickMove) return
    return _set.call(this, x, y)
  }
}

/** 「辅助 › 能力增强」的开关；工具设置同步后经 TOOL_SETTINGS_EVENT 更新 */
let smartPathOn: boolean | null = null

/** 热更新会重新执行本模块：监听放在全局，重装前先移除上一份 */
const SMART_PATH_LISTENERS_KEY = '__chayaSmartPathListeners_v1__'
type SmartPathListeners = { settings: (event: Event) => void; storage: (event: StorageEvent) => void }

function smartPathEnabled() {
  if (smartPathOn === null) {
    smartPathOn = readCachedToolSettings().smartPathEnabled
    const g = globalThis as typeof globalThis & { [SMART_PATH_LISTENERS_KEY]?: SmartPathListeners }
    const previous = g[SMART_PATH_LISTENERS_KEY]
    if (previous) {
      window.removeEventListener(TOOL_SETTINGS_EVENT, previous.settings)
      window.removeEventListener('storage', previous.storage)
    }
    const listeners: SmartPathListeners = {
      settings: (event) => {
        smartPathOn = (event as CustomEvent<ToolSettings>).detail.smartPathEnabled
      },
      // 在线版没有本机服务可轮询，同源的 Web 页写 localStorage 时靠 storage 事件同步
      storage: (event) => {
        if (event.key === TOOL_SETTINGS_STORAGE_KEY) smartPathOn = readCachedToolSettings().smartPathEnabled
      },
    }
    g[SMART_PATH_LISTENERS_KEY] = listeners
    window.addEventListener(TOOL_SETTINGS_EVENT, listeners.settings)
    window.addEventListener('storage', listeners.storage)
  }
  return smartPathOn
}

function ensureSmartPathHook() {
  installSmartPath(smartPathEnabled, createLogger('smart-path'))
}

function ensureExpHook() {
  const h = hooks()
  if (h.exp) return
  if (typeof Game_Actor === 'undefined' || !Game_Actor?.prototype?.gainExp) return
  h.exp = true
  const _gain = Game_Actor.prototype.gainExp
  Game_Actor.prototype.gainExp = function (exp: number) {
    const rate = flags().expRate
    const n = rate === 1 ? exp : Math.floor(Number(exp) * rate)
    return _gain.call(this, n)
  }
}

function ensureResourceSkipHook() {
  const h = hooks()
  if (h.resource) return
  h.resource = true

  try {
    if (typeof Bitmap !== 'undefined' && Bitmap.prototype && typeof Bitmap.prototype._onError === 'function') {
      const _onError = Bitmap.prototype._onError
      Bitmap.prototype._onError = function () {
        if (!flags().resourceSkip) return _onError.apply(this, arguments as unknown as [])
        try {
          this._loadingState = 'loaded'
          if (typeof this._callLoadListeners === 'function') this._callLoadListeners()
        } catch {
          try {
            return _onError.apply(this, arguments as unknown as [])
          } catch {
            /* */
          }
        }
      }
    }
  } catch {
    /* */
  }

  try {
    if (typeof Graphics !== 'undefined' && typeof Graphics.printLoadingError === 'function') {
      const _print = Graphics.printLoadingError
      Graphics.printLoadingError = function (url: string) {
        if (flags().resourceSkip) return
        return _print.call(this, url)
      }
    }
  } catch {
    /* */
  }
}

type NwWindowFs = {
  isFullscreen?: boolean
  enterFullscreen?: () => void
  leaveFullscreen?: () => void
  toggleFullscreen?: () => void
}

function getNwWindow(): NwWindowFs | null {
  try {
    const nw = (globalThis as typeof globalThis & { nw?: { Window?: { get?: () => NwWindowFs } } }).nw
    return nw?.Window?.get?.() ?? null
  } catch {
    return null
  }
}

function graphicsFullscreen(): boolean | null {
  const g = typeof Graphics !== 'undefined' ? Graphics : null
  if (!g) return null
  if (typeof g._isFullScreen === 'function') return !!g._isFullScreen()
  if (typeof document !== 'undefined') {
    const doc = document as Document & { webkitFullscreenElement?: Element | null }
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement)
  }
  return null
}

function readFullscreen(): boolean {
  const win = getNwWindow()
  if (win && typeof win.isFullscreen === 'boolean') return !!win.isFullscreen
  return graphicsFullscreen() ?? false
}

function writeFullscreen(on: boolean): boolean {
  const want = !!on
  const win = getNwWindow()
  if (win) {
    const cur = !!win.isFullscreen
    if (want === cur) return want
    try {
      if (want && typeof win.enterFullscreen === 'function') {
        win.enterFullscreen()
        return true
      }
      if (!want && typeof win.leaveFullscreen === 'function') {
        win.leaveFullscreen()
        return false
      }
      if (typeof win.toggleFullscreen === 'function') {
        win.toggleFullscreen()
        return want
      }
    } catch {
      /* fall through to Graphics */
    }
  }

  const g = typeof Graphics !== 'undefined' ? Graphics : null
  if (g) {
    const cur = graphicsFullscreen()
    if (cur != null && want === cur) return want
    try {
      if (want && typeof g._requestFullScreen === 'function') {
        g._requestFullScreen()
        return true
      }
      if (!want && typeof g._cancelFullScreen === 'function') {
        g._cancelFullScreen()
        return false
      }
    } catch {
      /* */
    }
  }
  return readFullscreen()
}

/**
 * 报错画面（`Graphics.printError`）会给画布加 `opacity: 0.5` + `blur(8px)` 并写错误文字；
 * 恢复运行不会撤掉，画面就一直蒙着一层。保留 errorPrinter 元素，之后的报错还能显示。
 */
function clearErrorScreen(): boolean {
  if (typeof Graphics === 'undefined') return false
  let cleared = false
  try {
    for (const el of [Graphics._canvas, Graphics._upperCanvas, Graphics._video]) {
      const style = el?.style
      if (!style) continue
      if (style.filter || style.webkitFilter || style.opacity) cleared = true
      style.filter = ''
      style.webkitFilter = ''
      style.opacity = ''
    }
    if (Graphics._errorPrinter?.innerHTML) {
      Graphics._errorPrinter.innerHTML = ''
      cleared = true
    }
    Graphics._errorShowed = false
  } catch {
    /* */
  }
  return cleared
}

export const RunCheats = {
  ensureHooks() {
    ensureTouchHook()
    ensureSmartPathHook()
    ensureExpHook()
    ensureResourceSkipHook()
  },
  /** 增强寻路不依赖会话盘状态，插件启动即安装 */
  ensureSmartPathHook,

  disposeHooks() {
    const f = flags()
    f.clickTeleport = false
    f.clickMove = true
    f.expRate = 1
    f.resourceSkip = false
  },

  getEncounter(): boolean {
    const s = sys()
    if (!s) return true
    if (typeof s.isEncounterEnabled === 'function') return !!s.isEncounterEnabled()
    return s._encounterEnabled !== false
  },
  setEncounter(on: boolean) {
    const s = sys()
    if (!s) return false
    if (typeof s.setEncounterEnabled === 'function') s.setEncounterEnabled(!!on)
    else s._encounterEnabled = !!on
    return this.getEncounter()
  },

  getMenuEnabled(): boolean {
    const s = sys()
    if (!s) return true
    if (typeof s.isMenuEnabled === 'function') return !!s.isMenuEnabled()
    return s._menuEnabled !== false
  },
  setMenuEnabled(on: boolean) {
    const s = sys()
    if (!s) return false
    if (on && typeof s.enableMenu === 'function') s.enableMenu()
    else if (!on && typeof s.disableMenu === 'function') s.disableMenu()
    else s._menuEnabled = !!on
    return this.getMenuEnabled()
  },

  getSaveEnabled(): boolean {
    const s = sys()
    if (!s) return true
    if (typeof s.isSaveEnabled === 'function') return !!s.isSaveEnabled()
    return s._saveEnabled !== false
  },
  setSaveEnabled(on: boolean) {
    const s = sys()
    if (!s) return false
    if (on && typeof s.enableSave === 'function') s.enableSave()
    else if (!on && typeof s.disableSave === 'function') s.disableSave()
    else s._saveEnabled = !!on
    return this.getSaveEnabled()
  },

  getClickMove() {
    return flags().clickMove
  },
  setClickMove(on: boolean) {
    ensureTouchHook()
    flags().clickMove = !!on
    return flags().clickMove
  },

  getClickTeleport() {
    return flags().clickTeleport
  },
  setClickTeleport(on: boolean) {
    ensureTouchHook()
    flags().clickTeleport = !!on
    return flags().clickTeleport
  },

  getFollowersVisible(): boolean {
    if (!gamePlayer() || typeof gamePlayer().followers !== 'function') return true
    const f = gamePlayer().followers()
    if (!f) return true
    if (typeof f.isVisible === 'function') return !!f.isVisible()
    return f._visible !== false
  },
  setFollowersVisible(on: boolean) {
    if (!gamePlayer() || typeof gamePlayer().followers !== 'function') return false
    const fol = gamePlayer().followers()
    if (!fol) return false
    if (on && typeof fol.show === 'function') fol.show()
    else if (!on && typeof fol.hide === 'function') fol.hide()
    else if (typeof fol.setVisible === 'function') fol.setVisible(!!on)
    else fol._visible = !!on
    return this.getFollowersVisible()
  },

  getExpRate() {
    return flags().expRate
  },
  setExpRate(n: number) {
    ensureExpHook()
    const v = Number(n)
    flags().expRate = Number.isFinite(v) ? Math.max(0, Math.min(99, Math.round(v * 100) / 100)) : 1
    return flags().expRate
  },

  getResourceSkip() {
    return flags().resourceSkip
  },
  setResourceSkip(on: boolean) {
    ensureResourceSkipHook()
    flags().resourceSkip = !!on
    return flags().resourceSkip
  },

  getFullscreen() {
    return readFullscreen()
  },
  setFullscreen(on: boolean) {
    return writeFullscreen(on)
  },

  pushScene(id: ScenePushId) {
    if (typeof SceneManager === 'undefined' || typeof SceneManager.push !== 'function') return false
    const ctor = SCENE_MAP[id]?.()
    if (!ctor) return false
    SceneManager.push(ctor)
    return true
  },

  popScene() {
    if (typeof SceneManager === 'undefined' || typeof SceneManager.pop !== 'function') return false
    SceneManager.pop()
    return true
  },

  gotoTitle() {
    if (typeof SceneManager === 'undefined' || typeof Scene_Title === 'undefined') return false
    if (typeof SceneManager.goto === 'function') {
      SceneManager.goto(Scene_Title)
      return true
    }
    return false
  },

  gotoMap() {
    if (typeof SceneManager === 'undefined' || typeof Scene_Map === 'undefined') return false
    if (typeof SceneManager.goto === 'function') {
      SceneManager.goto(Scene_Map)
      return true
    }
    return false
  },

  fadeIn() {
    if (typeof SceneManager === 'undefined') return false
    const scene = SceneManager._scene
    if (scene && typeof scene.startFadeIn === 'function') {
      scene.startFadeIn(24, false)
      return true
    }
    if (typeof gameScreen()?.startFadeIn === 'function') {
      gameScreen().startFadeIn(24)
      return true
    }
    return false
  },

  clearPictures() {
    if (typeof gameScreen()?.clearPictures === 'function') {
      gameScreen().clearPictures()
      return true
    }
    return false
  },

  clearMoveRoute() {
    let n = 0
    const clearOne = (ch: any) => {
      if (!ch) return
      try {
        ch._moveRouteForcing = false
        ch._moveRoute = null
        ch._moveRouteIndex = 0
        n++
      } catch {
        /* */
      }
    }
    clearOne(gamePlayer())
    if (gameMap() && typeof gameMap().events === 'function') {
      for (const ev of gameMap().events()) clearOne(ev)
    }
    return n > 0
  },

  closeAllWindows() {
    try {
      if (gameMessage() && typeof gameMessage().clear === 'function') gameMessage().clear()
    } catch {
      /* */
    }
    const scene = typeof SceneManager !== 'undefined' ? SceneManager._scene : null
    if (scene && Array.isArray(scene._windowLayer?.children)) {
      for (const w of [...scene._windowLayer.children]) {
        try {
          if (w && typeof w.deactivate === 'function') w.deactivate()
          if (w && typeof w.close === 'function') w.close()
          if (w && typeof w.hide === 'function') w.hide()
        } catch {
          /* */
        }
      }
      return true
    }
    return !!gameMessage()
  },

  /** 清掉盖在画面上的东西：报错残留的模糊 / 半透明、色调、闪烁、淡出、震动、天气；图片另有「清除图片」 */
  clearOverlay() {
    let n = clearErrorScreen() ? 1 : 0
    const screen = gameScreen()
    if (screen) {
      const call = (key: string, ...args: unknown[]) => {
        if (typeof screen[key] !== 'function') return
        try {
          screen[key](...args)
          n++
        } catch {
          /* */
        }
      }
      call('startTint', [0, 0, 0, 0], 0)
      call('clearFlash')
      call('clearFade')
      call('clearShake')
      call('changeWeather', 'none', 0, 0)
    }
    const scene = typeof SceneManager !== 'undefined' ? SceneManager._scene : null
    if (scene?._fadeSprite) {
      scene._fadeDuration = 0
      scene._fadeSprite.opacity = 0
      n++
    }
    return n > 0
  },

  resumeAfterError() {
    clearErrorScreen()
    try {
      if (typeof SceneManager !== 'undefined') {
        if (typeof SceneManager.resume === 'function') SceneManager.resume()
        SceneManager._stopped = false
      }
    } catch {
      /* */
    }
    return true
  },

  setEnemyHp(mode: 'one' | 'max') {
    if (!gameTroop() || typeof gameTroop().members !== 'function') return false
    let n = 0
    for (const e of gameTroop().members()) {
      if (!e || (typeof e.isHidden === 'function' && e.isHidden())) continue
      if (typeof e.isDead === 'function' && e.isDead()) continue
      if (typeof e.setHp !== 'function') continue
      if (mode === 'one') e.setHp(1)
      else if (typeof e.mhp === 'number') e.setHp(e.mhp)
      n++
    }
    return n > 0
  },

  setPartyHp(mode: 'one' | 'zero' | 'max') {
    if (!$gameParty || typeof $gameParty.members !== 'function') return false
    let n = 0
    for (const m of $gameParty.members()) {
      if (!m || typeof m.setHp !== 'function') continue
      if (mode === 'zero') m.setHp(0)
      else if (mode === 'one') m.setHp(1)
      else if (typeof m.mhp === 'number') {
        if (typeof m.isDead === 'function' && m.isDead() && typeof m.revive === 'function') m.revive()
        m.setHp(m.mhp)
        if (typeof m.setMp === 'function' && typeof m.mmp === 'number') m.setMp(m.mmp)
      }
      n++
    }
    return n > 0
  },
}

declare const $gameSystem: any
declare const $gameParty: any
declare const Game_Temp: { prototype: { setDestination: (x: number, y: number) => void; clearDestination?: () => void } }
declare const Game_Actor: { prototype: { gainExp: (exp: number) => void } }
declare const Bitmap: {
  prototype: { _onError: (...args: unknown[]) => void; _loadingState?: string; _callLoadListeners?: () => void }
}
declare const Graphics: {
  printLoadingError?: (url: string) => void
  _errorPrinter?: { innerHTML: string } | null
  _errorShowed?: boolean
  _canvas?: { style?: CSSStyleDeclaration }
  _upperCanvas?: { style?: CSSStyleDeclaration }
  _video?: { style?: CSSStyleDeclaration }
  _isFullScreen?: () => boolean
  _requestFullScreen?: () => void
  _cancelFullScreen?: () => void
}
declare const SceneManager: {
  push?: (scene: unknown) => void
  pop?: () => void
  goto?: (scene: unknown) => void
  resume?: () => void
  _stopped?: boolean
  _scene?: {
    startFadeIn?: (duration: number, white: boolean) => void
    _windowLayer?: { children: any[] }
    _fadeDuration?: number
    _fadeSprite?: { opacity: number }
  }
}
declare const Scene_Status: unknown
declare const Scene_Equip: unknown
declare const Scene_Skill: unknown
declare const Scene_Item: unknown
declare const Scene_Menu: unknown
declare const Scene_Load: unknown
declare const Scene_Save: unknown
declare const Scene_Options: unknown
declare const Scene_Debug: unknown
declare const Scene_Title: unknown
declare const Scene_Map: unknown
