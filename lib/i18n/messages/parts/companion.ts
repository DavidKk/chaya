import type { MessageTree } from '@/lib/i18n/messages/types'

/** 旅伴对话与「迷你地图 / 旅伴」设置页 */
type CompanionPart = Pick<MessageTree, 'companion' | 'tools'>

export const companionZh = {
  companion: {
    conversationAria: '与旅伴的对话',
    unavailable: 'Agent 暂不可用',
    inputAria: '与旅伴闲谈或交代任务',
    placeholder: '聊天或交代任务…',
    stop: '停止任务',
    clear: '清理卡住的任务',
    cleared: '已清理，可以重新交代任务了',
    send: '发送',
    thinking: '思考中…',
    acting: '操作中…',
    observing: '观察中…',
    verifying: '确认中…',
    failed: 'Agent 执行失败',
  },
  tools: {
    minimapDesc: '在地图详情中显示可移动的迷你地图。',
    minimapPage: '在游戏中查看当前地图全貌和角色位置',
    companionDesc: '在游戏中显示旅伴：陪你闲谈，也能替你打理游戏中的琐事。',
    companionPage: '选一位旅伴与你同行，陪你闲谈，也能替你打理游戏中的琐事',
    character: '角色',
    turnOn: '开启 {name}',
    turnOff: '关闭 {name}',
  },
} as const satisfies CompanionPart

export const companionEn = {
  companion: {
    conversationAria: 'Companion conversation',
    unavailable: 'Agent unavailable',
    inputAria: 'Companion chat and tasks',
    placeholder: 'Chat or give a task…',
    stop: 'Stop task',
    clear: 'Clear stuck tasks',
    cleared: 'Cleared. You can give me a new task.',
    send: 'Send',
    thinking: 'Thinking…',
    acting: 'Acting…',
    observing: 'Looking…',
    verifying: 'Checking…',
    failed: 'Agent failed',
  },
  tools: {
    minimapDesc: 'Show the movable mini map in map details.',
    minimapPage: 'See the whole current map and where you are while playing',
    companionDesc: 'Show your companion in game: someone to chat with, who can also handle chores for you.',
    companionPage: 'Pick a companion to travel with you, chat along the way, and handle chores in the game',
    character: 'Character',
    turnOn: 'Turn on {name}',
    turnOff: 'Turn off {name}',
  },
} as const satisfies CompanionPart

export const companionJa = {
  companion: {
    conversationAria: '旅の仲間との会話',
    unavailable: 'エージェントは現在利用できません',
    inputAria: '旅の仲間との会話とタスク',
    placeholder: '会話やタスクを入力…',
    stop: 'タスクを停止',
    clear: '止まったタスクを解除',
    cleared: '解除しました。新しいタスクを頼めます',
    send: '送信',
    thinking: '考え中…',
    acting: '操作中…',
    observing: '様子を見ています…',
    verifying: '確認中…',
    failed: 'エージェントの実行に失敗しました',
  },
  tools: {
    minimapDesc: 'マップ詳細に移動できるミニマップを表示します。',
    minimapPage: 'プレイ中に現在のマップ全体と自分の位置を確認できます',
    companionDesc: 'ゲーム中に旅の仲間を表示します。雑談の相手になり、ゲーム内の用事も任せられます。',
    companionPage: '共に旅する仲間を選びましょう。雑談の相手になり、ゲーム内の用事も任せられます',
    character: 'キャラクター',
    turnOn: '{name}をオン',
    turnOff: '{name}をオフ',
  },
} as const satisfies CompanionPart

export const companionKo = {
  companion: {
    conversationAria: '길동무와의 대화',
    unavailable: '에이전트를 사용할 수 없습니다',
    inputAria: '길동무와의 대화와 작업',
    placeholder: '대화나 작업 입력…',
    stop: '작업 중지',
    clear: '멈춘 작업 정리',
    cleared: '정리했어요. 새 작업을 맡길 수 있어요',
    send: '보내기',
    thinking: '생각 중…',
    acting: '조작 중…',
    observing: '살펴보는 중…',
    verifying: '확인 중…',
    failed: '에이전트 실행 실패',
  },
  tools: {
    minimapDesc: '지도 상세에서 이동 가능한 미니맵을 표시합니다.',
    minimapPage: '플레이 중 현재 지도 전체와 내 위치를 확인합니다',
    companionDesc: '게임에서 길동무를 표시합니다. 이야기를 나누고 게임 속 잡일도 맡길 수 있어요.',
    companionPage: '함께 길을 걸을 길동무를 고르세요. 이야기를 나누고 게임 속 잡일도 맡길 수 있어요',
    character: '캐릭터',
    turnOn: '{name} 켜기',
    turnOff: '{name} 끄기',
  },
} as const satisfies CompanionPart
