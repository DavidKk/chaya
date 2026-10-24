const AUTH_COPY = {
  zh: {
    aria: '允许网页控制 Agent',
    title: '允许此 Chaya 网页控制 Agent？',
    description: '网页将能让 Agent 使用普通按键和移动托管游戏。本次游戏进程内只确认一次。',
    deny: '拒绝',
    allow: '允许',
  },
  cht: {
    aria: '允許網頁控制 Agent',
    title: '允許此 Chaya 網頁控制 Agent？',
    description: '網頁將能讓 Agent 使用普通按鍵和移動託管遊戲。本次遊戲處理程序內只確認一次。',
    deny: '拒絕',
    allow: '允許',
  },
  en: {
    aria: 'Allow web Agent control',
    title: 'Allow this Chaya page to control the Agent?',
    description: 'The page can let the Agent use ordinary movement and input controls. This is asked once for this game process.',
    deny: 'Deny',
    allow: 'Allow',
  },
  ja: {
    aria: 'Web からの Agent 操作を許可',
    title: 'この Chaya ページによる Agent 操作を許可しますか？',
    description: 'Agent が通常の移動やキー入力でゲームを操作できるようになります。このゲームプロセスでは一度だけ確認します。',
    deny: '拒否',
    allow: '許可',
  },
  ko: {
    aria: '웹 Agent 제어 허용',
    title: '이 Chaya 페이지의 Agent 제어를 허용할까요?',
    description: 'Agent가 일반 이동과 키 입력으로 게임을 조작할 수 있습니다. 이 게임 프로세스에서는 한 번만 확인합니다。',
    deny: '거부',
    allow: '허용',
  },
  fr: {
    aria: 'Autoriser le contrôle de l\x27Agent via le Web',
    title: 'Autoriser cette page Chaya à contrôler l\x27Agent ?',
    description: 'La page permettra à l\x27Agent d\x27utiliser les touches et mouvements habituels pour piloter le jeu. Confirmation unique par session de jeu.',
    deny: 'Refuser',
    allow: 'Autoriser',
  },
  de: {
    aria: 'Web-Agenten-Steuerung erlauben',
    title: 'Dieser Chaya-Webseite die Steuerung des Agenten erlauben?',
    description: 'Die Webseite erlaubt dem Agenten, das Spiel mit normalen Tasten und Bewegungen zu steuern. Wird pro Spielsitzung nur einmal abgefragt.',
    deny: 'Ablehnen',
    allow: 'Erlauben',
  },
  es: {
    aria: 'Permitir control del agente web',
    title: '¿Permitir que esta página de Chaya controle el agente?',
    description: 'La página permitirá al agente usar controles de movimiento y teclas habituales para el juego. Se solicita una sola vez por sesión.',
    deny: 'Denegar',
    allow: 'Permitir',
  },
  ru: {
    aria: 'Разрешить управление агентом через веб',
    title: 'Разрешить этой странице Chaya управлять агентом?',
    description: 'Страница позволит агенту использовать обычные клавиши и перемещения для игры. Запрашивается один раз за сеанс игры.',
    deny: 'Отклонить',
    allow: 'Разрешить',
  },
  'pt-BR': {
    aria: 'Permitir controle do Agent via web',
    title: 'Permitir que esta página do Chaya controle o Agent?',
    description: 'A página permitirá que o Agent use teclas e movimentos habituais para gerenciar o jogo. Solicitado apenas uma vez por processo de jogo.',
    deny: 'Recusar',
    allow: 'Permitir',
  },
} as const

export function authorizationCopy() {
  const locale = String(document.documentElement.lang || navigator.language || 'zh').toLowerCase()
  if (locale === 'zh-tw' || locale === 'zh-hk' || locale === 'zh-hant' || locale === 'cht') return AUTH_COPY.cht
  if (locale.startsWith('ja')) return AUTH_COPY.ja
  if (locale.startsWith('ko')) return AUTH_COPY.ko
  if (locale.startsWith('fr')) return AUTH_COPY.fr
  if (locale.startsWith('de')) return AUTH_COPY.de
  if (locale.startsWith('es')) return AUTH_COPY.es
  if (locale.startsWith('ru')) return AUTH_COPY.ru
  if (locale.startsWith('pt')) return AUTH_COPY['pt-BR']
  if (locale.startsWith('en')) return AUTH_COPY.en
  return AUTH_COPY.zh
}
