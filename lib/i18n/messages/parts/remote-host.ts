export const remoteHostEn = {
  launchMode: 'Game window',
  launchModeDesc:
    'Show the game window or hide it for background play. Saved on the host for all clients. Applies on the next launch; quit the current game first. Both modes still render and encode video.',
  windowed: 'Visible',
  silent: 'Hidden',
  targetFpsDesc: 'Video encoding and streaming target: 60 FPS for smoother play (recommended), 30 FPS for lower bandwidth.',
  mute: 'Mute host speakers',
  muteDesc: 'Mute only this game on the host. MV/MZ audio continues to stream to clients.',
  audioNotice: 'VX/VX Ace client audio is not supported yet. Muting the host also means no game sound on the client.',
  loadFailed: 'Could not load host settings.',
  saveFailed: 'Could not save host settings. Your previous settings remain active.',
}

export type RemoteHostMessages = { [K in keyof typeof remoteHostEn]: string }

export const remoteHostZh: RemoteHostMessages = {
  launchMode: '游戏窗口',
  launchModeDesc: '显示游戏窗口，或隐藏窗口在后台运行。保存到主机，所有客户端共用，下次启动生效；请先退出当前游戏。两种模式仍需渲染和编码画面。',
  windowed: '显示',
  silent: '隐藏',
  targetFpsDesc: '画面编码与传输目标帧率：60 FPS 更流畅（推荐），30 FPS 更省流量。',
  mute: '主机游戏静音',
  muteDesc: '仅静音主机上的游戏，不影响其他应用。MV/MZ 声音仍传输到客户端。',
  audioNotice: 'VX / VX Ace 暂不支持客户端声音；静音主机后，客户端也没有游戏声音。',
  loadFailed: '无法读取主机设置。',
  saveFailed: '保存主机设置失败，仍使用原设置。',
}

export const remoteHostCht: RemoteHostMessages = {
  launchMode: '遊戲視窗',
  launchModeDesc: '顯示遊戲視窗，或隱藏視窗於背景執行。儲存至主機，所有用戶端共用，下次啟動生效；請先退出目前遊戲。兩種模式仍需繪製及編碼畫面。',
  windowed: '顯示',
  silent: '隱藏',
  targetFpsDesc: '畫面編碼與傳輸目標幀率：60 FPS 更流暢（建議），30 FPS 更省流量。',
  mute: '主機遊戲靜音',
  muteDesc: '僅將主機上的遊戲靜音，不影響其他應用。MV/MZ 聲音仍傳送至用戶端。',
  audioNotice: 'VX / VX Ace 暫不支援用戶端聲音；主機靜音後，用戶端也沒有遊戲聲音。',
  loadFailed: '無法讀取主機設定。',
  saveFailed: '儲存主機設定失敗，仍使用原設定。',
}

export const remoteHostJa: RemoteHostMessages = {
  launchMode: 'ゲームウィンドウ',
  launchModeDesc:
    'ゲームウィンドウを表示するか、非表示で実行します。ホストに保存し全クライアントで共有。現在のゲーム終了後、次回起動時に適用します。両モードとも描画と映像のエンコードが必要です。',
  windowed: '表示',
  silent: '非表示',
  targetFpsDesc: '映像のエンコードと配信の目標値。60 FPS は滑らかさ重視（推奨）、30 FPS は通信量を抑えます。',
  mute: 'ホストのゲーム音を消音',
  muteDesc: '他のアプリに影響せず、このゲームだけを消音します。MV/MZ の音声はクライアントに配信されます。',
  audioNotice: 'VX / VX Ace のクライアント音声は未対応です。ホストを消音するとクライアントでも音声を聞けません。',
  loadFailed: 'ホスト設定を読み込めませんでした。',
  saveFailed: 'ホスト設定を保存できませんでした。以前の設定が有効です。',
}

export const remoteHostKo: RemoteHostMessages = {
  launchMode: '게임 창',
  launchModeDesc:
    '게임 창을 표시하거나 숨긴 채 백그라운드에서 실행합니다. 호스트에 저장되어 모든 클라이언트가 공유합니다. 현재 게임을 종료한 후 다음 실행부터 적용됩니다. 두 모드 모두 화면 렌더링과 인코딩이 필요합니다.',
  windowed: '표시',
  silent: '숨김',
  targetFpsDesc: '영상 인코딩 및 전송 목표: 60 FPS는 부드러운 화면(권장), 30 FPS는 데이터 절약에 적합합니다.',
  mute: '호스트 게임 음소거',
  muteDesc: '다른 앱에 영향을 주지 않고 이 게임만 음소거합니다. MV/MZ 오디오는 클라이언트로 계속 전송됩니다.',
  audioNotice: 'VX / VX Ace 클라이언트 오디오는 아직 지원되지 않습니다. 호스트를 음소거하면 클라이언트에서도 게임 소리가 나지 않습니다.',
  loadFailed: '호스트 설정을 불러오지 못했습니다.',
  saveFailed: '호스트 설정을 저장하지 못했습니다. 이전 설정이 유지됩니다.',
}

export const remoteHostDe: RemoteHostMessages = {
  launchMode: 'Spielfenster',
  launchModeDesc:
    'Spielfenster anzeigen oder im Hintergrund verbergen. Auf dem Host für alle Clients gespeichert. Gilt beim nächsten Start; das laufende Spiel zuerst beenden. Beide Modi rendern und kodieren weiterhin Video.',
  windowed: 'Sichtbar',
  silent: 'Verborgen',
  targetFpsDesc: 'Ziel für Videokodierung und Übertragung: 60 FPS für flüssigeres Spielen (empfohlen), 30 FPS für weniger Datenverbrauch.',
  mute: 'Spiel auf dem Host stummschalten',
  muteDesc: 'Schaltet nur dieses Spiel auf dem Host stumm. MV/MZ-Audio wird weiterhin an Clients übertragen.',
  audioNotice: 'Client-Audio für VX / VX Ace wird noch nicht unterstützt. Bei stummem Host ist auch auf dem Client kein Spielton verfügbar.',
  loadFailed: 'Host-Einstellungen konnten nicht geladen werden.',
  saveFailed: 'Host-Einstellungen konnten nicht gespeichert werden. Die bisherigen Einstellungen bleiben aktiv.',
}

export const remoteHostEs: RemoteHostMessages = {
  launchMode: 'Ventana del juego',
  launchModeDesc:
    'Muestra la ventana del juego u ocúltala en segundo plano. Se guarda en el anfitrión para todos los clientes. Se aplica al próximo inicio; cierra primero el juego actual. Ambos modos siguen renderizando y codificando vídeo.',
  windowed: 'Visible',
  silent: 'Oculta',
  targetFpsDesc: 'Objetivo de codificación y transmisión: 60 FPS para mayor fluidez (recomendado), 30 FPS para consumir menos datos.',
  mute: 'Silenciar juego en el anfitrión',
  muteDesc: 'Silencia solo este juego en el anfitrión. El audio de MV/MZ sigue transmitiéndose a los clientes.',
  audioNotice: 'VX / VX Ace aún no admite audio en el cliente. Al silenciar el anfitrión, tampoco habrá sonido del juego en el cliente.',
  loadFailed: 'No se pudo cargar la configuración del anfitrión.',
  saveFailed: 'No se pudo guardar la configuración. Sigue activa la configuración anterior.',
}

export const remoteHostFr: RemoteHostMessages = {
  launchMode: 'Fenêtre du jeu',
  launchModeDesc:
    'Affichez la fenêtre du jeu ou masquez-la en arrière-plan. Enregistré sur l’hôte pour tous les clients. Appliqué au prochain lancement ; quittez d’abord le jeu actuel. Les deux modes continuent le rendu et l’encodage vidéo.',
  windowed: 'Visible',
  silent: 'Masquée',
  targetFpsDesc: 'Objectif d’encodage et de diffusion : 60 FPS pour plus de fluidité (recommandé), 30 FPS pour réduire le débit.',
  mute: 'Couper le son du jeu sur l’hôte',
  muteDesc: 'Coupe uniquement ce jeu sur l’hôte. Le son MV/MZ reste transmis aux clients.',
  audioNotice: 'Le son client VX / VX Ace n’est pas encore pris en charge. Couper le son de l’hôte supprime aussi le son du jeu côté client.',
  loadFailed: 'Impossible de charger les paramètres de l’hôte.',
  saveFailed: 'Impossible d’enregistrer les paramètres. Les paramètres précédents restent actifs.',
}

export const remoteHostRu: RemoteHostMessages = {
  launchMode: 'Окно игры',
  launchModeDesc:
    'Показывать окно игры или скрывать его для работы в фоне. Сохраняется на хосте для всех клиентов. Применяется при следующем запуске; сначала закройте текущую игру. В обоих режимах сохраняются рендеринг и кодирование видео.',
  windowed: 'Видимое',
  silent: 'Скрытое',
  targetFpsDesc: 'Целевая частота кодирования и передачи: 60 FPS для плавной игры (рекомендуется), 30 FPS для экономии трафика.',
  mute: 'Отключить звук игры на хосте',
  muteDesc: 'Отключает только звук этой игры на хосте. Звук MV/MZ продолжает передаваться клиентам.',
  audioNotice: 'Звук VX / VX Ace на клиенте пока не поддерживается. При отключении звука на хосте клиент также останется без звука игры.',
  loadFailed: 'Не удалось загрузить настройки хоста.',
  saveFailed: 'Не удалось сохранить настройки хоста. Действуют прежние настройки.',
}

export const remoteHostPtBR: RemoteHostMessages = {
  launchMode: 'Janela do jogo',
  launchModeDesc:
    'Mostre a janela do jogo ou oculte-a em segundo plano. Salvo no host para todos os clientes. Vale na próxima execução; encerre o jogo atual primeiro. Os dois modos continuam renderizando e codificando vídeo.',
  windowed: 'Visível',
  silent: 'Oculta',
  targetFpsDesc: 'Meta de codificação e transmissão: 60 FPS para maior fluidez (recomendado), 30 FPS para consumir menos dados.',
  mute: 'Silenciar jogo no host',
  muteDesc: 'Silencia apenas este jogo no host. O áudio de MV/MZ continua sendo transmitido aos clientes.',
  audioNotice: 'O áudio de VX / VX Ace no cliente ainda não é suportado. Ao silenciar o host, o cliente também fica sem som do jogo.',
  loadFailed: 'Não foi possível carregar as configurações do host.',
  saveFailed: 'Não foi possível salvar as configurações. As configurações anteriores continuam ativas.',
}
