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
}

export const playEn: PlayMessages = {
  launchAndStream: 'Launch Game & Stream',
  launchGame: 'Launch Game',
  switchGame: 'Switch Game',
  directConnect: 'Direct Connect',
  clearReload: 'Clear Cache & Reload',
  clearReloadDesc: 'Reset preferences and reload',
  gameNotRunning: 'Game not running · Waiting to launch',
  waitingLaunch: 'Ready to launch',
  gameSelectorTitle: 'Available Games',
  consoleTitle: 'Stream Console',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnect: 'Reconnect Game',
  cancelConnect: 'Cancel',
  autoConnecting: 'Establishing WebRTC game stream channel…',
  pausedConnecting: 'Auto-connection paused. Tap below to connect.',
  launchingLocalGame: 'Launching local game process and preparing stream…',
  diagLogs: 'Diagnostic Logs',
  gamepadTab: 'Gamepad',
  quickTab: 'Quick Actions',
  displayTab: 'Audio & Video',
  systemTab: 'Preferences',
  controlModeTitle: 'Control Mode',
  modeFixed: 'Fixed Gamepad',
  modeTouch: 'Screen Touch',
  modeDynamic: 'Dynamic Joystick',
  modeFixedDesc: 'Fixed virtual joystick on the lower-left, action buttons on the right.',
  modeTouchDesc: 'Hides virtual buttons. Screen taps act as mouse / direct touch input.',
  modeDynamicDesc: 'Press anywhere on the left screen to spawn a joystick dynamically.',
  audioOutput: 'Audio Output',
  muted: 'Muted (Tap to unmute)',
  unmuted: 'Sound On',
  scalingMode: 'Aspect Ratio',
  fitCover: 'Fill Screen',
  fitContain: 'Fit Screen',
  perfHud: 'Real-time HUD (FPS / Latency)',
  shown: 'Enabled',
  hidden: 'Disabled',
  fullscreen: 'Fullscreen Display',
  exitFullscreen: 'Exit Fullscreen',
  iosAddHomeScreen: 'Add to iOS Home Screen',
  inGameConsole: 'In-Game Console (Quick Cheats)',
  openPanel: 'Open',
  viewLogs: 'View Logs',
  selected: 'Current',
  tapToSelect: 'Tap to select',
  preferencesTitle: 'Game Management & Preferences',
  audioVisualTitle: 'Audio & Video Settings',
  inGameControlTitle: 'In-Game Controls & Diagnostics',
  failed: 'Failed',
}

export const playZh: PlayMessages = {
  launchAndStream: '启动游戏并连入串流',
  launchGame: '启动游戏',
  switchGame: '切换游戏',
  directConnect: '直接尝试连接',
  clearReload: '清理缓存并重载',
  clearReloadDesc: '重置偏好并刷新',
  gameNotRunning: '游戏未运行 · 待拉起',
  waitingLaunch: '待启动',
  gameSelectorTitle: '可运行游戏列表',
  consoleTitle: '串流控制台',
  connecting: '连接中…',
  connected: '已连接游戏串流',
  disconnected: '串流已断开',
  reconnect: '重新连接游戏',
  cancelConnect: '取消连接',
  autoConnecting: '正在自动建立游戏串流通道…',
  pausedConnecting: '已暂停自动连接。点击下方按钮开始连接',
  launchingLocalGame: '正在拉起本地游戏进程并准备 WebRTC 串流…',
  diagLogs: '诊断日志',
  gamepadTab: '操作手柄',
  quickTab: '快捷面板',
  displayTab: '音画设置',
  systemTab: '系统偏好',
  controlModeTitle: '操作控制模式',
  modeFixed: '固定手柄',
  modeTouch: '屏幕触摸',
  modeDynamic: '自由摇杆',
  modeFixedDesc: '固定手柄：左下角固定虚拟摇杆，右侧动作按键。',
  modeTouchDesc: '屏幕触摸：隐藏所有虚拟按键，触屏点击作为鼠标/触控操作。',
  modeDynamicDesc: '自由摇杆：在左半屏任意处触屏下压，即刻在该位置生成摇杆。',
  audioOutput: '声音输出',
  muted: '已静音 (点击开声)',
  unmuted: '已开启',
  scalingMode: '画面缩放模式',
  fitCover: '铺满全屏',
  fitContain: '等比适应',
  perfHud: '实时性能 HUD (FPS / 延迟)',
  shown: '已显示',
  hidden: '已隐藏',
  fullscreen: '全屏显示',
  exitFullscreen: '退出全屏',
  iosAddHomeScreen: 'iOS添加主屏幕',
  inGameConsole: '局内控制台 (常用修改)',
  openPanel: '打开面板',
  viewLogs: '查看日志',
  selected: '当前选中',
  tapToSelect: '点击选择',
  preferencesTitle: '游戏管理与系统偏好',
  audioVisualTitle: '声音与画面设置',
  inGameControlTitle: '局内控制与诊断',
  failed: '失败',
}

export const playCht: PlayMessages = {
  launchAndStream: '啟動遊戲並連入串流',
  launchGame: '啟動遊戲',
  switchGame: '切換遊戲',
  directConnect: '直接嘗試連線',
  clearReload: '清理快取並重載',
  clearReloadDesc: '重設偏好並重新整理',
  gameNotRunning: '遊戲未執行 · 待啟動',
  waitingLaunch: '待啟動',
  gameSelectorTitle: '可執行遊戲清單',
  consoleTitle: '串流主控台',
  connecting: '連線中…',
  connected: '已連線遊戲串流',
  disconnected: '串流已中斷',
  reconnect: '重新連線遊戲',
  cancelConnect: '取消連線',
  autoConnecting: '正在自動建立遊戲串流通道…',
  pausedConnecting: '已暫停自動連線。點擊下方按鈕開始連線',
  launchingLocalGame: '正在拉起本機遊戲行程並準備 WebRTC 串流…',
  diagLogs: '診斷記錄',
  gamepadTab: '操作手把',
  quickTab: '捷徑面板',
  displayTab: '影音設定',
  systemTab: '系統偏好',
  controlModeTitle: '操作控制模式',
  modeFixed: '固定手把',
  modeTouch: '螢幕觸控',
  modeDynamic: '自由搖桿',
  modeFixedDesc: '固定手把：左下角固定虛擬搖桿，右側動作按鍵。',
  modeTouchDesc: '螢幕觸控：隱藏所有虛擬按鍵，觸控點擊作為滑鼠/觸控操作。',
  modeDynamicDesc: '自由搖桿：在左半螢幕任意處觸控下壓，即刻在該位置生成搖桿。',
  audioOutput: '聲音輸出',
  muted: '已靜音 (點擊開啟)',
  unmuted: '已開啟',
  scalingMode: '畫面縮放模式',
  fitCover: '填滿全螢幕',
  fitContain: '等比例適應',
  perfHud: '即時效能 HUD (FPS / 延遲)',
  shown: '已顯示',
  hidden: '已隱藏',
  fullscreen: '全螢幕顯示',
  exitFullscreen: '結束全螢幕',
  iosAddHomeScreen: 'iOS加入主畫面',
  inGameConsole: '局內主控台 (常用修改)',
  openPanel: '開啟面板',
  viewLogs: '檢視記錄',
  selected: '目前選取',
  tapToSelect: '點擊選取',
  preferencesTitle: '遊戲管理與系統偏好',
  audioVisualTitle: '聲音與畫面設定',
  inGameControlTitle: '局內控制與診斷',
  failed: '失敗',
}

export const playJa: PlayMessages = {
  launchAndStream: 'ゲーム起動＆配信接続',
  launchGame: 'ゲーム起動',
  switchGame: 'ゲーム切り替え',
  directConnect: '直接接続を試行',
  clearReload: 'キャッシュ削除＆再読み込み',
  clearReloadDesc: '設定を初期化して再読み込み',
  gameNotRunning: 'ゲーム未起動・待機中',
  waitingLaunch: '起動待ち',
  gameSelectorTitle: '起動可能ゲーム一覧',
  consoleTitle: '配信コンソール',
  connecting: '接続中…',
  connected: 'ゲーム配信に接続しました',
  disconnected: '配信が切断されました',
  reconnect: '再接続',
  cancelConnect: 'キャンセル',
  autoConnecting: 'WebRTC ストリーミング回線を確立中…',
  pausedConnecting: '自動接続を一時停止しました。ボタンを押して接続してください。',
  launchingLocalGame: 'ローカルプロセスを起動して配信を準備中…',
  diagLogs: '診断ログ',
  gamepadTab: 'パッド',
  quickTab: 'クイック',
  displayTab: '映像と音声',
  systemTab: 'システム',
  controlModeTitle: '操作モード',
  modeFixed: '固定パッド',
  modeTouch: 'タッチ操作',
  modeDynamic: '動的スティック',
  modeFixedDesc: '左下に固定バーチャルスティック、右側にアクションボタンを配置。',
  modeTouchDesc: 'バーチャルボタンを非表示にし、タップを直接マウス/タッチ入力として使用。',
  modeDynamicDesc: '画面左半分を押した位置にスティックを動的に生成。',
  audioOutput: '音声出力',
  muted: 'ミュート中（タップで解除）',
  unmuted: '音声オン',
  scalingMode: '画面比率',
  fitCover: '全画面拡大',
  fitContain: '等比フィット',
  perfHud: 'パフォーマンス HUD (FPS / 遅延)',
  shown: '表示',
  hidden: '非表示',
  fullscreen: '全画面表示',
  exitFullscreen: '全画面終了',
  iosAddHomeScreen: 'ホーム画面に追加',
  inGameConsole: 'ゲーム内コンソール',
  openPanel: '開く',
  viewLogs: 'ログ表示',
  selected: '選択中',
  tapToSelect: 'タップして選択',
  preferencesTitle: 'ゲーム管理とシステム設定',
  audioVisualTitle: '映像と音声の設定',
  inGameControlTitle: 'ゲーム内制御と診断',
  failed: '失敗',
}

export const playKo: PlayMessages = { ...playEn, launchGame: '게임 시작', switchGame: '게임 변경', reconnect: '다시 연결' }
export const playDe: PlayMessages = { ...playEn, launchGame: 'Spiel starten', switchGame: 'Spiel wechseln', reconnect: 'Erneut verbinden' }
export const playEs: PlayMessages = { ...playEn, launchGame: 'Iniciar juego', switchGame: 'Cambiar juego', reconnect: 'Reconectar' }
export const playFr: PlayMessages = { ...playEn, launchGame: 'Lancer le jeu', switchGame: 'Changer de jeu', reconnect: 'Reconnecter' }
export const playRu: PlayMessages = { ...playEn, launchGame: 'Запустить игру', switchGame: 'Сменить игру', reconnect: 'Переподключить' }
export const playPtBR: PlayMessages = { ...playEn, launchGame: 'Iniciar jogo', switchGame: 'Trocar jogo', reconnect: 'Reconectar' }
