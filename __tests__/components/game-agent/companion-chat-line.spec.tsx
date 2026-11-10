/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { type ChatLine, CompanionChatLine } from '@/components/game-agent/CompanionChatLine'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

let host: HTMLDivElement
let root: Root

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

function renderLine(line: ChatLine, pending: { question: string; progress: string } | null = null) {
  return act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionChatLine line={line} character="rin" pending={pending} offerLocked={false} onAnswer={jest.fn()} />
      </LocaleProvider>
    )
  })
}

describe('CompanionChatLine', () => {
  it('renders a plain chat message inline', async () => {
    const line: ChatLine = {
      id: '1',
      role: 'chaya',
      text: '你好，今天天气不错！',
    }
    await renderLine(line)
    expect(host.textContent).toContain('你好，今天天气不错！')
    expect(host.querySelector('details')).toBeNull()
  })

  it('renders both collapsible thinking process and LLM return content when thought is present', async () => {
    const line: ChatLine = {
      id: '2',
      role: 'chaya',
      text: '我已经准备好探索地下城了！',
      thought: {
        id: 't-1',
        model: 'deepseek-r1',
        durationMs: 2500,
        promptSummary: '分析地牢入口风险与战术准备',
        thought: '检测到玩家携带火把数量充足，建议以稳健步调前进...',
        decision: '整理行装并跟随玩家出发',
        at: Date.now(),
      },
    }
    await renderLine(line)

    // LLM return content must be shown
    expect(host.textContent).toContain('我已经准备好探索地下城了！')

    // Collapsible details element must be present
    const details = host.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.getAttribute('open')).toBeNull() // closed by default

    // Summary contains thinking title and duration
    expect(details?.querySelector('summary')?.textContent).toContain('思考过程')
    expect(details?.querySelector('summary')?.textContent).toContain('2500ms')
    expect(details?.querySelector('summary')?.textContent).toContain('deepseek-r1')

    // Thinking details content
    expect(details?.textContent).toContain('分析目标：')
    expect(details?.textContent).toContain('分析地牢入口风险与战术准备')
    expect(details?.textContent).toContain('检测到玩家携带火把数量充足')
    expect(details?.textContent).toContain('推理结论：')
    expect(details?.textContent).toContain('整理行装并跟随玩家出发')
  })

  it('does not return null when line has thought and empty text; displays decision as return content', async () => {
    const line: ChatLine = {
      id: '3',
      role: 'chaya',
      text: '',
      thought: {
        id: 't-2',
        model: 'qwen3:4b',
        durationMs: 1200,
        promptSummary: '机关解谜分析',
        thought: '分析拉杆位置与对应铁门联动机制...',
        decision: '前往 Lever Switch (2, 3) 触发拉杆',
        at: Date.now(),
      },
    }
    await renderLine(line)

    // Must NOT be empty / null
    expect(host.children.length).toBeGreaterThan(0)

    // Collapsible thinking block
    const details = host.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.textContent).toContain('机关解谜分析')

    // Returned decision content must be displayed
    expect(host.textContent).toContain('推理结论：前往 Lever Switch (2, 3) 触发拉杆')
  })

  it('renders thought when only thought text exists with no decision and no main text', async () => {
    const line: ChatLine = {
      id: '4',
      role: 'chaya',
      text: '',
      thought: {
        id: 't-3',
        model: 'ollama-model',
        durationMs: 800,
        thought: '正在推演多种战术走位可能...',
        at: Date.now(),
      },
    }
    await renderLine(line)

    expect(host.children.length).toBeGreaterThan(0)
    const details = host.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.textContent).toContain('正在推演多种战术走位可能...')
  })

  it('returns null when message has no text, no thought, no card, and no pending', async () => {
    const line: ChatLine = {
      id: '5',
      role: 'chaya',
      text: '',
    }
    await renderLine(line)
    expect(host.children.length).toBe(0)
  })
})
