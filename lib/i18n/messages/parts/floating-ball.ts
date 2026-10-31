export type FloatingBallMessages = {
  title: string
  description: string
  limit: string
  bindings: string
  add: string
  empty: string
  reset: string
  moveUp: string
  moveDown: string
  remove: string
  open: string
  close: string
  drag: string
  unsupported: string
  needBattle: string
  leaveBattle: string
  notReady: string
  failed: string
  on: string
  off: string
}

export const floatingBallZh: FloatingBallMessages = {
  title: '悬浮球',
  description: '仅在游戏内显示。点击展开环绕按钮，拖动调整位置；开关显示当前状态。',
  limit: '最多绑定 {count} 个功能，按顺序围绕悬浮球展开。',
  bindings: '快捷功能与顺序',
  add: '添加快捷功能',
  empty: '尚未绑定功能，请在辅助 → 悬浮球中添加。',
  reset: '恢复默认绑定',
  moveUp: '上移 {name}',
  moveDown: '下移 {name}',
  remove: '移除 {name}',
  open: '展开快捷功能',
  close: '收起快捷功能',
  drag: '拖动调整位置；按方向键微调',
  unsupported: '当前引擎不支持此功能',
  needBattle: '仅战斗中可用',
  leaveBattle: '请先结束战斗',
  notReady: '请先进入游戏或读取存档',
  failed: '执行失败，请重试',
  on: '已开启',
  off: '已关闭',
}

export const floatingBallCht: FloatingBallMessages = {
  title: '懸浮球',
  description: '僅在遊戲內顯示。點擊展開環繞按鈕，拖曳調整位置；開關顯示目前狀態。',
  limit: '最多綁定 {count} 個功能，依序環繞懸浮球展開。',
  bindings: '快捷功能與順序',
  add: '新增快捷功能',
  empty: '尚未綁定功能，請在輔助 → 懸浮球中新增。',
  reset: '恢復預設綁定',
  moveUp: '上移 {name}',
  moveDown: '下移 {name}',
  remove: '移除 {name}',
  open: '展開快捷功能',
  close: '收起快捷功能',
  drag: '拖曳調整位置；按方向鍵微調',
  unsupported: '目前引擎不支援此功能',
  needBattle: '僅戰鬥中可用',
  leaveBattle: '請先結束戰鬥',
  notReady: '請先進入遊戲或讀取存檔',
  failed: '執行失敗，請重試',
  on: '已開啟',
  off: '已關閉',
}

export const floatingBallEn: FloatingBallMessages = {
  title: 'Floating ball',
  description: 'Click for shortcuts, drag to reposition. Toggles show the current game state.',
  limit: 'Bind up to {count} controls, arranged around the floating ball in order.',
  bindings: 'Shortcuts and order',
  add: 'Add shortcut',
  empty: 'No shortcuts bound. Add them in Assist → Floating ball.',
  reset: 'Restore default shortcuts',
  moveUp: 'Move {name} up',
  moveDown: 'Move {name} down',
  remove: 'Remove {name}',
  open: 'Open shortcuts',
  close: 'Close shortcuts',
  drag: 'Drag to move; use arrow keys for fine adjustments',
  unsupported: 'Unsupported by this engine',
  needBattle: 'Only available in battle',
  leaveBattle: 'Finish the battle first',
  notReady: 'Start a game or load a save first',
  failed: 'Action failed. Please try again.',
  on: 'On',
  off: 'Off',
}

export const floatingBallJa: FloatingBallMessages = {
  title: 'フローティングボタン',
  description: 'クリックでショートカットを開き、ドラッグで移動。切替はゲームの現在の状態を表示します。',
  limit: '最大 {count} 個の機能をボタンの周囲に順番に配置します。',
  bindings: 'ショートカットと順序',
  add: 'ショートカットを追加',
  empty: '未設定です。補助 → フローティングボタンで追加してください。',
  reset: '既定の設定に戻す',
  moveUp: '{name}を上へ',
  moveDown: '{name}を下へ',
  remove: '{name}を削除',
  open: 'ショートカットを開く',
  close: 'ショートカットを閉じる',
  drag: 'ドラッグで移動、矢印キーで微調整',
  unsupported: 'このエンジンでは非対応',
  needBattle: '戦闘中のみ使用可能',
  leaveBattle: '先に戦闘を終了してください',
  notReady: 'ゲームを開始するかセーブを読み込んでください',
  failed: '実行できませんでした。再試行してください。',
  on: 'オン',
  off: 'オフ',
}

export const floatingBallFr: FloatingBallMessages = {
  title: 'Bouton flottant',
  description: 'Cliquez pour les raccourcis, faites glisser pour déplacer. Les interrupteurs affichent l’état actuel du jeu.',
  limit: 'Jusqu’à {count} commandes, disposées dans l’ordre autour du bouton.',
  bindings: 'Raccourcis et ordre',
  add: 'Ajouter un raccourci',
  empty: 'Aucun raccourci. Ajoutez-en dans Assistance → Bouton flottant.',
  reset: 'Rétablir les raccourcis',
  moveUp: 'Monter {name}',
  moveDown: 'Descendre {name}',
  remove: 'Retirer {name}',
  open: 'Ouvrir les raccourcis',
  close: 'Fermer les raccourcis',
  drag: 'Glisser pour déplacer ; flèches pour ajuster',
  unsupported: 'Non pris en charge par ce moteur',
  needBattle: 'Disponible uniquement en combat',
  leaveBattle: 'Terminez le combat d’abord',
  notReady: 'Lancez une partie ou chargez une sauvegarde',
  failed: 'Échec. Veuillez réessayer.',
  on: 'Activé',
  off: 'Désactivé',
}

export const floatingBallDe: FloatingBallMessages = {
  title: 'Schwebender Button',
  description: 'Klicken für Kurzbefehle, ziehen zum Verschieben. Schalter zeigen den aktuellen Spielstatus.',
  limit: 'Bis zu {count} Funktionen, der Reihe nach um den Button angeordnet.',
  bindings: 'Kurzbefehle und Reihenfolge',
  add: 'Kurzbefehl hinzufügen',
  empty: 'Keine Kurzbefehle. Unter Assistenz → Schwebender Button hinzufügen.',
  reset: 'Standard wiederherstellen',
  moveUp: '{name} nach oben',
  moveDown: '{name} nach unten',
  remove: '{name} entfernen',
  open: 'Kurzbefehle öffnen',
  close: 'Kurzbefehle schließen',
  drag: 'Ziehen zum Verschieben; Pfeiltasten zur Feinjustierung',
  unsupported: 'Von dieser Engine nicht unterstützt',
  needBattle: 'Nur im Kampf verfügbar',
  leaveBattle: 'Zuerst den Kampf beenden',
  notReady: 'Spiel starten oder Spielstand laden',
  failed: 'Aktion fehlgeschlagen. Erneut versuchen.',
  on: 'Ein',
  off: 'Aus',
}

export const floatingBallEs: FloatingBallMessages = {
  title: 'Botón flotante',
  description: 'Pulsa para ver atajos y arrastra para mover. Los interruptores muestran el estado actual del juego.',
  limit: 'Hasta {count} controles, dispuestos en orden alrededor del botón.',
  bindings: 'Atajos y orden',
  add: 'Añadir atajo',
  empty: 'Sin atajos. Añádelos en Asistencia → Botón flotante.',
  reset: 'Restaurar atajos',
  moveUp: 'Subir {name}',
  moveDown: 'Bajar {name}',
  remove: 'Quitar {name}',
  open: 'Abrir atajos',
  close: 'Cerrar atajos',
  drag: 'Arrastra para mover; usa las flechas para ajustar',
  unsupported: 'No compatible con este motor',
  needBattle: 'Solo disponible en combate',
  leaveBattle: 'Termina el combate primero',
  notReady: 'Inicia una partida o carga una guardada',
  failed: 'La acción falló. Inténtalo de nuevo.',
  on: 'Activado',
  off: 'Desactivado',
}

export const floatingBallRu: FloatingBallMessages = {
  title: 'Плавающая кнопка',
  description: 'Нажмите для быстрых действий, перетащите для перемещения. Переключатели показывают состояние игры.',
  limit: 'До {count} функций, расположенных по порядку вокруг кнопки.',
  bindings: 'Действия и порядок',
  add: 'Добавить действие',
  empty: 'Нет действий. Добавьте их в разделе Помощь → Плавающая кнопка.',
  reset: 'Восстановить действия',
  moveUp: 'Поднять {name}',
  moveDown: 'Опустить {name}',
  remove: 'Удалить {name}',
  open: 'Открыть действия',
  close: 'Закрыть действия',
  drag: 'Перетащите для перемещения; стрелки для точной настройки',
  unsupported: 'Не поддерживается этим движком',
  needBattle: 'Доступно только в бою',
  leaveBattle: 'Сначала завершите бой',
  notReady: 'Начните игру или загрузите сохранение',
  failed: 'Не удалось выполнить действие. Повторите попытку.',
  on: 'Вкл.',
  off: 'Выкл.',
}

export const floatingBallPtBR: FloatingBallMessages = {
  title: 'Botão flutuante',
  description: 'Clique para atalhos e arraste para mover. Os interruptores mostram o estado atual do jogo.',
  limit: 'Até {count} controles, dispostos em ordem ao redor do botão.',
  bindings: 'Atalhos e ordem',
  add: 'Adicionar atalho',
  empty: 'Sem atalhos. Adicione em Assistência → Botão flutuante.',
  reset: 'Restaurar atalhos',
  moveUp: 'Mover {name} para cima',
  moveDown: 'Mover {name} para baixo',
  remove: 'Remover {name}',
  open: 'Abrir atalhos',
  close: 'Fechar atalhos',
  drag: 'Arraste para mover; use as setas para ajustar',
  unsupported: 'Não suportado por este motor',
  needBattle: 'Disponível apenas em batalha',
  leaveBattle: 'Termine a batalha primeiro',
  notReady: 'Inicie um jogo ou carregue um save',
  failed: 'Falha na ação. Tente novamente.',
  on: 'Ativado',
  off: 'Desativado',
}

export const floatingBallKo: FloatingBallMessages = {
  title: '플로팅 버튼',
  description: '클릭하여 바로 가기를 열고 드래그하여 이동합니다. 스위치는 현재 게임 상태를 표시합니다.',
  limit: '최대 {count}개 기능이 버튼 주위에 순서대로 배치됩니다.',
  bindings: '바로 가기 및 순서',
  add: '바로 가기 추가',
  empty: '등록된 기능이 없습니다. 보조 → 플로팅 버튼에서 추가하세요.',
  reset: '기본 바로 가기 복원',
  moveUp: '{name} 위로',
  moveDown: '{name} 아래로',
  remove: '{name} 제거',
  open: '바로 가기 열기',
  close: '바로 가기 닫기',
  drag: '드래그로 이동, 방향키로 미세 조정',
  unsupported: '이 엔진에서는 지원하지 않습니다',
  needBattle: '전투 중에만 사용 가능',
  leaveBattle: '먼저 전투를 종료하세요',
  notReady: '게임을 시작하거나 저장을 불러오세요',
  failed: '실행하지 못했습니다. 다시 시도하세요.',
  on: '켜짐',
  off: '꺼짐',
}
