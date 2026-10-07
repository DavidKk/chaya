import type { MessageTree } from '@/lib/i18n/messages/types'

type CompanionPart = Pick<MessageTree, 'companion'>

export const companionZh = {
  companion: {
    conversationAria: '与旅伴的对话',
    unavailable: 'Agent 暂不可用',
    inputAria: '与旅伴闲谈或交代任务',
    placeholder: '聊天或交代任务…',
    stop: '停止任务',
    send: '发送',
    thinking: '思考中…',
    acting: '操作中…',
    observing: '观察中…',
    verifying: '确认中…',
    failed: 'Agent 执行失败',
  },
} as const satisfies CompanionPart

export const companionEn = {
  companion: {
    conversationAria: 'Companion conversation',
    unavailable: 'Agent unavailable',
    inputAria: 'Companion chat and tasks',
    placeholder: 'Chat or give a task…',
    stop: 'Stop task',
    send: 'Send',
    thinking: 'Thinking…',
    acting: 'Acting…',
    observing: 'Looking…',
    verifying: 'Checking…',
    failed: 'Agent failed',
  },
} as const satisfies CompanionPart

export const companionJa = {
  companion: {
    conversationAria: '旅の仲間との会話',
    unavailable: 'エージェントは現在利用できません',
    inputAria: '旅の仲間との会話とタスク',
    placeholder: '会話やタスクを入力…',
    stop: 'タスクを停止',
    send: '送信',
    thinking: '考え中…',
    acting: '操作中…',
    observing: '様子を見ています…',
    verifying: '確認中…',
    failed: 'エージェントの実行に失敗しました',
  },
} as const satisfies CompanionPart

export const companionKo = {
  companion: {
    conversationAria: '길동무와의 대화',
    unavailable: '에이전트를 사용할 수 없습니다',
    inputAria: '길동무와의 대화와 작업',
    placeholder: '대화나 작업 입력…',
    stop: '작업 중지',
    send: '보내기',
    thinking: '생각 중…',
    acting: '조작 중…',
    observing: '살펴보는 중…',
    verifying: '확인 중…',
    failed: '에이전트 실행 실패',
  },
} as const satisfies CompanionPart
