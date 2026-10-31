export type PlayMessages = {
  launchAndStream: string
  launchGame: string
  switchGame: string
  directConnect: string
  clearReload: string
  clearReloadDesc: string
  gameNotRunning: string
  waitingLaunch: string
  gameSelectorTitle: string
  consoleTitle: string
  connecting: string
  connected: string
  disconnected: string
  reconnect: string
  cancelConnect: string
  autoConnecting: string
  pausedConnecting: string
  launchingLocalGame: string
  diagLogs: string
  gamepadTab: string
  quickTab: string
  displayTab: string
  systemTab: string
  controlModeTitle: string
  modeFixed: string
  modeTouch: string
  modeDynamic: string
  modeFixedDesc: string
  modeTouchDesc: string
  modeDynamicDesc: string
  audioOutput: string
  muted: string
  unmuted: string
  scalingMode: string
  fitCover: string
  fitContain: string
  perfHud: string
  shown: string
  hidden: string
  fullscreen: string
  exitFullscreen: string
  iosAddHomeScreen: string
  inGameConsole: string
  openPanel: string
  viewLogs: string
  selected: string
  tapToSelect: string
  preferencesTitle: string
  audioVisualTitle: string
  inGameControlTitle: string
  failed: string
  modeSingleLeft: string
  modeSingleRight: string
  platformDesktop: string
  platformMobile: string
  platformMode: string
  reloadConfirmTitle: string
  reloadConfirmDesc: string
  quitGame: string
  quitGameConfirmTitle: string
  quitGameConfirmDesc: string
  gameExited: string
  keyboardHints: string
}

export const playEn: PlayMessages = {
  launchAndStream: 'Launch & Stream',
  launchGame: 'Launch Game',
  switchGame: 'Switch Game',
  directConnect: 'Connect',
  clearReload: 'Clear Cache',
  clearReloadDesc: 'Reset & Reload',
  gameNotRunning: 'Game Offline',
  waitingLaunch: 'Ready',
  gameSelectorTitle: 'Available Games',
  consoleTitle: 'Stream Console',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnect: 'Reconnect',
  cancelConnect: 'Cancel',
  autoConnecting: 'Connecting to game stream…',
  pausedConnecting: 'Connection paused. Tap to retry.',
  launchingLocalGame: 'Launching game process…',
  diagLogs: 'Logs',
  gamepadTab: 'Gamepad',
  quickTab: 'Quick',
  displayTab: 'Display',
  systemTab: 'System',
  controlModeTitle: 'Control Mode',
  modeFixed: 'Fixed',
  modeTouch: 'Touch',
  modeDynamic: 'Dynamic',
  modeFixedDesc: '',
  modeTouchDesc: '',
  modeDynamicDesc: '',
  audioOutput: 'Audio',
  muted: 'Muted',
  unmuted: 'Sound On',
  scalingMode: 'Ratio',
  fitCover: 'Fill',
  fitContain: 'Fit',
  perfHud: 'HUD',
  shown: 'On',
  hidden: 'Off',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit Fullscreen',
  iosAddHomeScreen: 'Add to Home',
  inGameConsole: 'Cheats',
  openPanel: 'Open',
  viewLogs: 'View',
  selected: 'Current',
  tapToSelect: 'Select',
  preferencesTitle: 'Preferences',
  audioVisualTitle: 'Display & Audio',
  inGameControlTitle: 'Quick Actions',
  failed: 'Failed',
  modeSingleLeft: 'Left',
  modeSingleRight: 'Right',
  platformDesktop: 'PC',
  platformMobile: 'Mobile',
  platformMode: 'Layout',
  reloadConfirmTitle: 'Clear Cache & Reload?',
  reloadConfirmDesc: 'This will reset settings and purge local cache.',
  quitGame: 'Quit Game',
  quitGameConfirmTitle: 'Quit Current Game?',
  quitGameConfirmDesc: 'Host game process will be closed. Unsaved progress will be lost.',
  gameExited: 'Game exited',
  keyboardHints: 'WASD / Arrows move · Enter / Z confirm · Esc / X cancel · Shift dash',
}

export const playZh: PlayMessages = {
  launchAndStream: '启动游戏并连入串流',
  launchGame: '启动游戏',
  switchGame: '切换游戏',
  directConnect: '直接连接',
  clearReload: '清理重载',
  clearReloadDesc: '重置并刷新',
  gameNotRunning: '游戏未运行',
  waitingLaunch: '待启动',
  gameSelectorTitle: '可运行游戏列表',
  consoleTitle: '串流控制台',
  connecting: '连接中…',
  connected: '已连接',
  disconnected: '已断开',
  reconnect: '重新连接',
  cancelConnect: '取消连接',
  autoConnecting: '正在自动建立串流通道…',
  pausedConnecting: '已暂停连接，点击下方按钮重试',
  launchingLocalGame: '正在拉起游戏进程…',
  diagLogs: '诊断日志',
  gamepadTab: '手柄',
  quickTab: '快捷',
  displayTab: '音画',
  systemTab: '设置',
  controlModeTitle: '控制模式',
  modeFixed: '固定',
  modeTouch: '触屏',
  modeDynamic: '自由',
  modeFixedDesc: '',
  modeTouchDesc: '',
  modeDynamicDesc: '',
  audioOutput: '声音输出',
  muted: '静音',
  unmuted: '开启',
  scalingMode: '画面比例',
  fitCover: '铺满',
  fitContain: '适应',
  perfHud: '性能 HUD',
  shown: '显示',
  hidden: '隐藏',
  fullscreen: '全屏模式',
  exitFullscreen: '退出全屏',
  iosAddHomeScreen: '添加到主屏',
  inGameConsole: '修改控制台',
  openPanel: '打开',
  viewLogs: '查看',
  selected: '已选',
  tapToSelect: '选择',
  preferencesTitle: '偏好设置',
  audioVisualTitle: '音画设置',
  inGameControlTitle: '快捷控制',
  failed: '失败',
  modeSingleLeft: '左手',
  modeSingleRight: '右手',
  platformDesktop: 'PC 桌面',
  platformMobile: '手机触屏',
  platformMode: '操作端布局',
  reloadConfirmTitle: '清理缓存并重载？',
  reloadConfirmDesc: '将重置串流设置并清空本地缓存，确认重载？',
  quitGame: '退出游戏',
  quitGameConfirmTitle: '退出当前游戏？',
  quitGameConfirmDesc: '电脑端正在运行的游戏进程将被完全关闭，未保存进度将丢失。确认退出？',
  gameExited: '游戏已退出',
  keyboardHints: 'WASD / 方向键移动 · Z / Enter 确认 · X / Esc 取消 · Shift 加速',
}

export const playCht: PlayMessages = {
  launchAndStream: '啟動遊戲並連入串流',
  launchGame: '啟動遊戲',
  switchGame: '切換遊戲',
  directConnect: '直接連線',
  clearReload: '清理快取',
  clearReloadDesc: '重設並重新整理',
  gameNotRunning: '遊戲未執行',
  waitingLaunch: '待啟動',
  gameSelectorTitle: '可執行遊戲清單',
  consoleTitle: '串流主控台',
  connecting: '連線中…',
  connected: '已連線',
  disconnected: '已中斷',
  reconnect: '重新連線',
  cancelConnect: '取消連線',
  autoConnecting: '正在自動建立串流通道…',
  pausedConnecting: '已暫停連線，點擊下方按鈕重試',
  launchingLocalGame: '正在拉起遊戲行程…',
  diagLogs: '診斷記錄',
  gamepadTab: '手把',
  quickTab: '捷徑',
  displayTab: '影音',
  systemTab: '設定',
  controlModeTitle: '控制模式',
  modeFixed: '固定',
  modeTouch: '觸控',
  modeDynamic: '自由',
  modeFixedDesc: '',
  modeTouchDesc: '',
  modeDynamicDesc: '',
  audioOutput: '聲音輸出',
  muted: '靜音',
  unmuted: '開啟',
  scalingMode: '畫面比例',
  fitCover: '填滿',
  fitContain: '適應',
  perfHud: '效能 HUD',
  shown: '顯示',
  hidden: '隱藏',
  fullscreen: '全螢幕模式',
  exitFullscreen: '結束全螢幕',
  iosAddHomeScreen: '加入主畫面',
  inGameConsole: '修改主控台',
  openPanel: '開啟',
  viewLogs: '檢視',
  selected: '已選',
  tapToSelect: '選取',
  preferencesTitle: '偏好設定',
  audioVisualTitle: '影音設定',
  inGameControlTitle: '捷徑控制',
  failed: '失敗',
  modeSingleLeft: '左手',
  modeSingleRight: '右手',
  platformDesktop: 'PC 桌面',
  platformMobile: '手機觸控',
  platformMode: '操作端版面',
  reloadConfirmTitle: '清理快取並重載？',
  reloadConfirmDesc: '將重設串流設定並清空本機快取，確認重載？',
  quitGame: '結束遊戲',
  quitGameConfirmTitle: '結束目前遊戲？',
  quitGameConfirmDesc: '電腦端正在執行的遊戲行程將被關閉，未儲存進度將遺失。確認結束？',
  gameExited: '遊戲已結束',
  keyboardHints: 'WASD / 方向鍵移動 · Z / Enter 確認 · X / Esc 取消 · Shift 加速',
}

export const playJa: PlayMessages = {
  launchAndStream: '起動＆配信接続',
  launchGame: 'ゲーム起動',
  switchGame: 'ゲーム変更',
  directConnect: '直接接続',
  clearReload: 'キャッシュ削除',
  clearReloadDesc: '初期化して再読込',
  gameNotRunning: 'ゲーム未起動',
  waitingLaunch: '待機中',
  gameSelectorTitle: '利用可能なゲーム',
  consoleTitle: '配信コンソール',
  connecting: '接続中…',
  connected: '接続済み',
  disconnected: '切断',
  reconnect: '再接続',
  cancelConnect: 'キャンセル',
  autoConnecting: 'ストリーミング回線を接続中…',
  pausedConnecting: '接続停止中。タップして再試行',
  launchingLocalGame: 'ゲームを起動中…',
  diagLogs: '診断ログ',
  gamepadTab: 'パッド',
  quickTab: 'クイック',
  displayTab: '表示',
  systemTab: '設定',
  controlModeTitle: '操作モード',
  modeFixed: '固定',
  modeTouch: 'タッチ',
  modeDynamic: '自由',
  modeFixedDesc: '',
  modeTouchDesc: '',
  modeDynamicDesc: '',
  audioOutput: '音声出力',
  muted: 'ミュート',
  unmuted: 'オン',
  scalingMode: '画面比率',
  fitCover: '拡大',
  fitContain: '等比',
  perfHud: 'HUD',
  shown: '表示',
  hidden: '非表示',
  fullscreen: '全画面',
  exitFullscreen: '終了',
  iosAddHomeScreen: 'ホーム追加',
  inGameConsole: '改造ツール',
  openPanel: '開く',
  viewLogs: '表示',
  selected: '選択中',
  tapToSelect: '選択',
  preferencesTitle: 'システム設定',
  audioVisualTitle: '表示・音声',
  inGameControlTitle: 'クイック',
  failed: '失敗',
  modeSingleLeft: '左手',
  modeSingleRight: '右手',
  platformDesktop: 'PC',
  platformMobile: 'モバイル',
  platformMode: '端末形式',
  reloadConfirmTitle: 'キャッシュ削除＆再読込？',
  reloadConfirmDesc: '設定を初期化してキャッシュをクリアします。',
  quitGame: 'ゲーム終了',
  quitGameConfirmTitle: 'ゲームを終了しますか？',
  quitGameConfirmDesc: 'ホスト PC のゲームを終了します。セーブしていないデータは失われます。',
  gameExited: 'ゲームを終了しました',
  keyboardHints: 'WASD / 方向キーで移動 · Enter / Z 決定 · Esc / X キャンセル · Shift ダッシュ',
}

export const playKo: PlayMessages = { ...playEn, launchGame: '게임 시작', switchGame: '게임 변경', reconnect: '다시 연결' }
export const playDe: PlayMessages = { ...playEn, launchGame: 'Spiel starten', switchGame: 'Spiel wechseln', reconnect: 'Erneut verbinden' }
export const playEs: PlayMessages = { ...playEn, launchGame: 'Iniciar juego', switchGame: 'Cambiar juego', reconnect: 'Reconectar' }
export const playFr: PlayMessages = { ...playEn, launchGame: 'Lancer le jeu', switchGame: 'Changer de jeu', reconnect: 'Reconnecter' }
export const playRu: PlayMessages = { ...playEn, launchGame: 'Запустить игру', switchGame: 'Сменить игру', reconnect: 'Переподключить' }
export const playPtBR: PlayMessages = { ...playEn, launchGame: 'Iniciar jogo', switchGame: 'Trocar jogo', reconnect: 'Reconectar' }
