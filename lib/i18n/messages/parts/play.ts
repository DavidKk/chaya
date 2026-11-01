import {
  remoteHostCht,
  remoteHostDe,
  remoteHostEn,
  remoteHostEs,
  remoteHostFr,
  remoteHostJa,
  remoteHostKo,
  type RemoteHostMessages,
  remoteHostPtBR,
  remoteHostRu,
  remoteHostZh,
} from './remote-host'

export type PlayMessages = {
  hostSettings: RemoteHostMessages
  connectingTitle: string
  launchingTitle: string
  launchFailedTitle: string
  launchFailedDesc: string
  retryLaunch: string
  switchFailed: string
  quitFailed: string
  autoTalkEnabled: string
  autoTalkDisabled: string
  launchAndStream: string
  launchGame: string
  continueGame: string
  cloudGames: string
  localGames: string
  cloudRunning: string
  localRunning: string
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
  cancelLaunch: string
  connectionFailed: string
  connectionFailedDesc: string
  backToSelectGame: string
  retrying: string
  autoConnecting: string
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
  hapticFeedback: string
  enabled: string
  disabled: string
  controllerOpacity: string
  opacityHigh: string
  opacityMedium: string
  opacitySolid: string
  spectatorMode: string
  spectatorNotice: string
  exitSpectator: string
  claimControl: string
}

export const playEn: PlayMessages = {
  hostSettings: remoteHostEn,
  connectingTitle: 'CONNECTING',
  launchingTitle: 'Launching',
  launchFailedTitle: 'Launch Failed',
  launchFailedDesc: 'Could not start the game. Try again or select another game.',
  retryLaunch: 'Retry Launch',
  switchFailed: 'Could not switch game',
  quitFailed: 'Could not quit game',
  autoTalkEnabled: 'Auto-dialogue enabled',
  autoTalkDisabled: 'Auto-dialogue disabled',

  launchAndStream: 'Launch & Stream',
  launchGame: 'Launch Game',
  continueGame: 'Continue Game',
  cloudGames: 'Cloud Games',
  localGames: 'Local Games',
  cloudRunning: 'Running in cloud',
  localRunning: 'Running locally',
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
  cancelLaunch: 'Cancel Launch',
  connectionFailed: 'Connection Failed',
  connectionFailedDesc: 'Unable to connect to game stream. Please verify the game is running.',
  backToSelectGame: 'Select Game',
  retrying: 'Retrying',
  autoConnecting: 'Connecting to game stream…',
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
  hapticFeedback: 'Haptics',
  enabled: 'ON',
  disabled: 'OFF',
  controllerOpacity: 'Button Opacity',
  opacityHigh: '40%',
  opacityMedium: '65%',
  opacitySolid: '90%',
  spectatorMode: 'Spectator Mode',
  spectatorNotice: 'Another player is controlling. You are currently in spectator mode.',
  exitSpectator: 'Exit Spectating',
  claimControl: 'Take Control',
}

export const playZh: PlayMessages = {
  hostSettings: remoteHostZh,
  connectingTitle: 'CONNECTING',
  launchingTitle: '启动中',
  launchFailedTitle: '启动失败',
  launchFailedDesc: '游戏未能启动，请重试或选择其他游戏。',
  retryLaunch: '重新启动',
  switchFailed: '切换游戏失败',
  quitFailed: '退出游戏失败',
  autoTalkEnabled: '已开启自动对话',
  autoTalkDisabled: '已关闭自动对话',

  launchAndStream: '启动游戏并连入串流',
  launchGame: '启动游戏',
  continueGame: '继续游戏',
  cloudGames: '云端游戏',
  localGames: '本地游戏',
  cloudRunning: '云端运行中',
  localRunning: '本地运行中',
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
  cancelLaunch: '取消启动',
  connectionFailed: '连接失败',
  connectionFailedDesc: '无法连接至游戏串流服务，请确认游戏是否正在运行',
  backToSelectGame: '返回选择游戏',
  retrying: '正在重试',
  autoConnecting: '正在自动建立串流通道…',
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
  hapticFeedback: '触感震动',
  enabled: '开启',
  disabled: '关闭',
  controllerOpacity: '按键透明度',
  opacityHigh: '40%',
  opacityMedium: '65%',
  opacitySolid: '90%',
  spectatorMode: 'Spectator Mode',
  spectatorNotice: 'Another player is controlling. You are currently in spectator mode.',
  exitSpectator: 'Exit Spectating',
  claimControl: 'Take Control',
}

export const playCht: PlayMessages = {
  hostSettings: remoteHostCht,
  connectingTitle: 'CONNECTING',
  launchingTitle: '啟動中',
  launchFailedTitle: '啟動失敗',
  launchFailedDesc: '遊戲未能啟動，請重試或選擇其他遊戲。',
  retryLaunch: '重新啟動',
  switchFailed: '切換遊戲失敗',
  quitFailed: '退出遊戲失敗',
  autoTalkEnabled: '已開啟自動對話',
  autoTalkDisabled: '已關閉自動對話',

  launchAndStream: '啟動遊戲並連入串流',
  launchGame: '啟動遊戲',
  continueGame: '繼續遊戲',
  cloudGames: '雲端遊戲',
  localGames: '本機遊戲',
  cloudRunning: '雲端執行中',
  localRunning: '本機執行中',
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
  cancelLaunch: '取消啟動',
  connectionFailed: '連線失敗',
  connectionFailedDesc: '無法連線至遊戲串流服務，請確認遊戲是否正在執行',
  backToSelectGame: '返回選取遊戲',
  retrying: '正在重試',
  autoConnecting: '正在自動建立串流通道…',
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
  hapticFeedback: '觸感震動',
  enabled: '開啟',
  disabled: '關閉',
  controllerOpacity: '按鍵透明度',
  opacityHigh: '40%',
  opacityMedium: '65%',
  opacitySolid: '90%',
  spectatorMode: 'Spectator Mode',
  spectatorNotice: 'Another player is controlling. You are currently in spectator mode.',
  exitSpectator: 'Exit Spectating',
  claimControl: 'Take Control',
}

export const playJa: PlayMessages = {
  hostSettings: remoteHostJa,
  connectingTitle: '接続中',
  launchingTitle: '起動中',
  launchFailedTitle: '起動失敗',
  launchFailedDesc: 'ゲームを起動できませんでした。再試行するか、別のゲームを選択してください。',
  retryLaunch: '再起動',
  switchFailed: 'ゲームの切り替えに失敗しました',
  quitFailed: 'ゲームを終了できませんでした',
  autoTalkEnabled: '自動会話を有効にしました',
  autoTalkDisabled: '自動会話を無効にしました',

  launchAndStream: '起動＆配信接続',
  launchGame: 'ゲーム起動',
  continueGame: 'ゲームを続ける',
  cloudGames: 'クラウドゲーム',
  localGames: 'ローカルゲーム',
  cloudRunning: 'クラウドで実行中',
  localRunning: 'ローカルで実行中',
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
  cancelLaunch: '起動キャンセル',
  connectionFailed: '接続失敗',
  connectionFailedDesc: 'ゲーム配信サーバーに接続できません。ゲームが起動しているか確認してください。',
  backToSelectGame: 'ゲーム選択に戻る',
  retrying: '再試行中',
  autoConnecting: 'ストリーミング回線を接続中…',
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
  hapticFeedback: '振動フィードバック',
  enabled: 'オン',
  disabled: 'オフ',
  controllerOpacity: 'ボタン透明度',
  opacityHigh: '40%',
  opacityMedium: '65%',
  opacitySolid: '90%',
  spectatorMode: 'Spectator Mode',
  spectatorNotice: 'Another player is controlling. You are currently in spectator mode.',
  exitSpectator: 'Exit Spectating',
  claimControl: 'Take Control',
}

export const playKo: PlayMessages = {
  ...playEn,
  hostSettings: remoteHostKo,
  connectingTitle: '연결 중',
  launchingTitle: '시작 중',
  launchFailedTitle: '시작 실패',
  launchFailedDesc: '게임을 시작할 수 없습니다. 다시 시도하거나 다른 게임을 선택하세요.',
  retryLaunch: '다시 시작',
  switchFailed: '게임 변경 실패',
  quitFailed: '게임 종료 실패',
  autoTalkEnabled: '자동 대화 켜짐',
  autoTalkDisabled: '자동 대화 꺼짐',
  launchGame: '게임 시작',
  continueGame: '게임 계속',
  cloudGames: '클라우드 게임',
  localGames: '로컬 게임',
  cloudRunning: '클라우드 실행 중',
  localRunning: '로컬 실행 중',
  switchGame: '게임 변경',
  reconnect: '다시 연결',
}
export const playDe: PlayMessages = {
  ...playEn,
  hostSettings: remoteHostDe,
  connectingTitle: 'VERBINDEN',
  launchingTitle: 'Startet',
  launchFailedTitle: 'Start fehlgeschlagen',
  launchFailedDesc: 'Das Spiel konnte nicht starten. Erneut versuchen oder ein anderes Spiel wählen.',
  retryLaunch: 'Erneut starten',
  switchFailed: 'Spielwechsel fehlgeschlagen',
  quitFailed: 'Beenden fehlgeschlagen',
  autoTalkEnabled: 'Automatischer Dialog aktiviert',
  autoTalkDisabled: 'Automatischer Dialog deaktiviert',
  launchGame: 'Spiel starten',
  continueGame: 'Weiterspielen',
  cloudGames: 'Cloud-Spiele',
  localGames: 'Lokale Spiele',
  cloudRunning: 'Läuft in der Cloud',
  localRunning: 'Läuft lokal',
  switchGame: 'Spiel wechseln',
  reconnect: 'Erneut verbinden',
}
export const playEs: PlayMessages = {
  ...playEn,
  hostSettings: remoteHostEs,
  connectingTitle: 'CONECTANDO',
  launchingTitle: 'Iniciando',
  launchFailedTitle: 'Error al iniciar',
  launchFailedDesc: 'No se pudo iniciar el juego. Reintenta o elige otro.',
  retryLaunch: 'Reintentar inicio',
  switchFailed: 'No se pudo cambiar el juego',
  quitFailed: 'No se pudo cerrar el juego',
  autoTalkEnabled: 'Diálogo automático activado',
  autoTalkDisabled: 'Diálogo automático desactivado',
  launchGame: 'Iniciar juego',
  continueGame: 'Continuar',
  cloudGames: 'Juegos en la nube',
  localGames: 'Juegos locales',
  cloudRunning: 'En la nube',
  localRunning: 'En ejecución local',
  switchGame: 'Cambiar juego',
  reconnect: 'Reconectar',
}
export const playFr: PlayMessages = {
  ...playEn,
  hostSettings: remoteHostFr,
  connectingTitle: 'CONNEXION',
  launchingTitle: 'Démarrage',
  launchFailedTitle: 'Échec du démarrage',
  launchFailedDesc: 'Impossible de lancer le jeu. Réessayez ou choisissez un autre jeu.',
  retryLaunch: 'Relancer',
  switchFailed: 'Impossible de changer de jeu',
  quitFailed: 'Impossible de quitter le jeu',
  autoTalkEnabled: 'Dialogue automatique activé',
  autoTalkDisabled: 'Dialogue automatique désactivé',
  launchGame: 'Lancer le jeu',
  continueGame: 'Continuer',
  cloudGames: 'Jeux cloud',
  localGames: 'Jeux locaux',
  cloudRunning: 'En cours dans le cloud',
  localRunning: 'En cours en local',
  switchGame: 'Changer de jeu',
  reconnect: 'Reconnecter',
}
export const playRu: PlayMessages = {
  ...playEn,
  hostSettings: remoteHostRu,
  connectingTitle: 'ПОДКЛЮЧЕНИЕ',
  launchingTitle: 'Запуск',
  launchFailedTitle: 'Ошибка запуска',
  launchFailedDesc: 'Не удалось запустить игру. Повторите попытку или выберите другую игру.',
  retryLaunch: 'Повторить запуск',
  switchFailed: 'Не удалось сменить игру',
  quitFailed: 'Не удалось закрыть игру',
  autoTalkEnabled: 'Автодиалог включён',
  autoTalkDisabled: 'Автодиалог выключен',
  launchGame: 'Запустить игру',
  continueGame: 'Продолжить',
  cloudGames: 'Облачные игры',
  localGames: 'Локальные игры',
  cloudRunning: 'Запущена в облаке',
  localRunning: 'Запущена локально',
  switchGame: 'Сменить игру',
  reconnect: 'Переподключить',
}
export const playPtBR: PlayMessages = {
  ...playEn,
  hostSettings: remoteHostPtBR,
  connectingTitle: 'CONECTANDO',
  launchingTitle: 'Iniciando',
  launchFailedTitle: 'Falha ao iniciar',
  launchFailedDesc: 'Não foi possível iniciar o jogo. Tente novamente ou escolha outro.',
  retryLaunch: 'Tentar iniciar',
  switchFailed: 'Falha ao trocar o jogo',
  quitFailed: 'Falha ao fechar o jogo',
  autoTalkEnabled: 'Diálogo automático ativado',
  autoTalkDisabled: 'Diálogo automático desativado',
  launchGame: 'Iniciar jogo',
  continueGame: 'Continuar',
  cloudGames: 'Jogos na nuvem',
  localGames: 'Jogos locais',
  cloudRunning: 'Em execução na nuvem',
  localRunning: 'Em execução local',
  switchGame: 'Trocar jogo',
  reconnect: 'Reconectar',
}
