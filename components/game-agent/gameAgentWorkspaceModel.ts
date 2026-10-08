type Model = { name: string }

export type AgentProfile = {
  id: string
  label: string
  provider: string
  online: boolean
  models: Model[]
  defaultModel: string
  reason: string | null
}

export type AgentWorkspaceStatus = {
  available: boolean
  gameOnline: boolean
  profiles: AgentProfile[]
  defaultProfileId: string
  session: {
    id: string
    profileId: string
    activeTurnId: string | null
    recentTurnId?: string | null
    activeTurn?: { id: string; state: string; capability?: 'play' | 'ask' | 'companion'; phase?: string; goal?: string; question?: string; lastSeq: number } | null
  } | null
  reason: string | null
}

export type ToolActivity = { id: string; name: string; state: 'running' | 'completed' | 'failed' }
export type AgentWorkspaceMessage = { id: string; role: 'user' | 'assistant' | 'error'; text: string; tools?: ToolActivity[]; progress?: string[] }

type Copy = {
  title: string
  placeholder: string
  empty: string
  stop: string
  stopAndStart: string
  newSession: string
  send: string
  running: string
  observing: string
  thinking: string
  acting: string
  verifying: string
  toolCalling: string
  toolCalled: string
  toolFailed: string
  unavailable: string
  connect: string
}

export const GAME_AGENT_WORKSPACE_COPY: Record<string, Copy> = {
  zh: {
    title: 'Chaya 助手',
    placeholder: '输入任务或询问下一步建议…',
    empty: '我会根据你的要求调用当前可用工具。',
    stop: '停止',
    stopAndStart: '停止并开始新任务',
    newSession: '新会话',
    send: '发送',
    running: '进行中',
    observing: '正在观察游戏状态',
    thinking: '正在判断下一步',
    acting: '正在操作游戏',
    verifying: '正在确认操作结果',
    toolCalling: '正在调用',
    toolCalled: '已调用',
    toolFailed: '调用失败',
    unavailable: 'Agent 暂不可用',
    connect: '连接',
  },
  en: {
    title: 'Chaya Assistant',
    placeholder: 'Enter a task or ask for the next step…',
    empty: 'I will call the currently available tools for your request.',
    stop: 'Stop',
    stopAndStart: 'Stop and start new task',
    newSession: 'New session',
    send: 'Send',
    running: 'Running',
    observing: 'Observing the game',
    thinking: 'Deciding the next step',
    acting: 'Operating the game',
    verifying: 'Verifying the result',
    toolCalling: 'Calling',
    toolCalled: 'Called',
    toolFailed: 'Call failed',
    unavailable: 'Agent unavailable',
    connect: 'Connect',
  },
  ja: {
    title: 'Chaya アシスタント',
    placeholder: 'タスクまたは次の行動を入力…',
    empty: 'リクエストに応じて現在利用できるツールを呼び出します。',
    stop: '停止',
    stopAndStart: '停止して新しいタスクを開始',
    newSession: '新しい会話',
    send: '送信',
    running: '実行中',
    observing: 'ゲームを確認中',
    thinking: '次の行動を判断中',
    acting: 'ゲームを操作中',
    verifying: '操作結果を確認中',
    toolCalling: '呼び出し中',
    toolCalled: '呼び出し済み',
    toolFailed: '呼び出し失敗',
    unavailable: 'Agent を利用できません',
    connect: '接続',
  },
  ko: {
    title: 'Chaya 어시스턴트',
    placeholder: '작업을 입력하거나 다음 단계를 질문하세요…',
    empty: '요청에 따라 현재 사용 가능한 도구를 호출합니다.',
    stop: '중지',
    stopAndStart: '중지하고 새 작업 시작',
    newSession: '새 대화',
    send: '보내기',
    running: '진행 중',
    observing: '게임 상태 확인 중',
    thinking: '다음 행동 판단 중',
    acting: '게임 조작 중',
    verifying: '조작 결과 확인 중',
    toolCalling: '호출 중',
    toolCalled: '호출됨',
    toolFailed: '호출 실패',
    unavailable: 'Agent를 사용할 수 없습니다',
    connect: '연결',
  },
}

export function gameAgentErrorMessage(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}
