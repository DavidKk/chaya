/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AgentActivityTimeline } from '@/components/game-agent/AgentActivityTimeline'

let host: HTMLDivElement
let root: Root

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('shows semantic game events and filters without exposing raw JSON by default', async () => {
  await act(async () => {
    root.render(
      <AgentActivityTimeline
        events={[
          { seq: 1, type: 'agent.decision', data: { summary: '选择打开宝箱。', details: { reason: '符合玩家目标' } } },
          { seq: 2, type: 'game.dialogue', data: { summary: '老人：拿走吧。', details: { text: '拿走吧。' } } },
          { seq: 3, type: 'game.inventory_changed', data: { summary: '获得高级药水 ×1。', details: { change: 1 } } },
          { seq: 4, type: 'game.watch.registered', data: { phase: 'battle' } },
          { seq: 5, type: 'game.watch.paused', data: { phase: 'battle' } },
          { seq: 6, type: 'game.watch.triggered', data: { phase: 'map_navigation', changes: [{ kind: 'target_changed', eventId: 7 }] } },
        ]}
      />
    )
  })

  expect(host.textContent).toContain('选择打开宝箱。')
  expect(host.textContent).toContain('老人：拿走吧。')
  expect(host.textContent).toContain('获得高级药水 ×1。')
  expect(host.textContent).toContain('正在等待与当前方案相关的游戏变化（战斗）')
  expect(host.textContent).toContain('当前为战斗，由 Agent 自主观察和操作，不推送逐帧变化。')
  expect(host.textContent).toContain('检测到相关变化：目标状态变化 #7，重新评估方案。')
  expect(host.querySelector('details')?.open).toBe(false)

  const gameFilter = [...host.querySelectorAll('button')].find((button) => button.textContent === '游戏')!
  await act(async () => gameFilter.click())
  expect(gameFilter.getAttribute('aria-pressed')).toBe('true')
  expect(host.textContent).not.toContain('选择打开宝箱。')
  expect(host.textContent).toContain('老人：拿走吧。')
})

test('shows individual model and tool timings below the operation without duplicating game feedback', async () => {
  await act(async () => {
    root.render(
      <AgentActivityTimeline
        events={[
          { seq: 1, type: 'model.requested', at: 1000, data: { model: 'local' } },
          { seq: 2, type: 'model.completed', at: 14142, data: { model: 'local', durationMs: 13142, text: '已选择目标' } },
          { seq: 3, type: 'tool.started', at: 14143, data: { callId: 'a', name: 'chaya_live_interact' } },
          { seq: 4, type: 'tool.completed', at: 16643, data: { callId: 'a', name: 'chaya_live_interact', ok: false } },
          { seq: 5, type: 'game.dialogue', at: 16643, correlation: { actionId: 'a' }, data: { summary: '宝箱已经打开' } },
          { seq: 6, type: 'tool.completed', at: 16643, data: { callId: 'b', name: 'chaya_live_state', durationMs: 0 } },
          { seq: 7, type: 'model.completed', at: 16644, data: { model: 'local', text: '' } },
        ]}
      />
    )
  })
  expect(host.textContent).toContain('耗时 13.14 秒')
  expect(host.textContent).toContain('耗时 2.50 秒')
  expect(host.textContent).not.toContain('所属动作耗时')
  expect(host.textContent).toContain('耗时 0 ms')
  expect(host.textContent).toContain('耗时未记录')
  expect(host.textContent).not.toContain('正在操作')
  expect(host.querySelectorAll('ol > li').length).toBe(6)
  const operation = [...host.querySelectorAll('ol > li')].find((row) => row.textContent?.includes('操作失败'))!
  expect(operation.lastElementChild?.textContent).toContain('耗时 2.50 秒')
  expect(host.querySelectorAll('li li').length).toBe(0)
  const gameFilter = [...host.querySelectorAll('button')].find((button) => button.textContent === '游戏')!
  await act(async () => gameFilter.click())
  expect(host.textContent).not.toContain('所属动作耗时')
  expect(host.textContent).not.toContain('耗时 2.50 秒')
})

test('shows elapsed time for pending tools and stops updating when completed', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(5000)
  const clearInterval = jest.spyOn(window, 'clearInterval')
  try {
    const started = { seq: 1, type: 'tool.started', at: 1000, data: { callId: 'pending', name: 'chaya_live_press' } }
    await act(async () => root.render(<AgentActivityTimeline events={[started]} />))
    expect(host.textContent).toContain('执行中 · 已耗时 4.00 秒')
    await act(async () => jest.advanceTimersByTime(1000))
    expect(host.textContent).toContain('执行中 · 已耗时 5.00 秒')
    await act(async () =>
      root.render(
        <AgentActivityTimeline events={[started, { seq: 2, type: 'tool.completed', at: 6000, data: { callId: 'pending', name: 'chaya_live_press', durationMs: 5000 } }]} />
      )
    )
    expect(host.textContent).not.toContain('执行中')
    expect(host.textContent).toContain('耗时 5.00 秒')
    expect(clearInterval).toHaveBeenCalled()
  } finally {
    clearInterval.mockRestore()
    jest.useRealTimers()
  }
})

test('updates a model request timer and freezes its own duration when the response arrives', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(5000)
  try {
    const requested = { seq: 1, type: 'model.requested', data: { model: 'local', startedAt: 1000, contextDurationMs: 7 } }
    await act(async () => root.render(<AgentActivityTimeline compact events={[requested]} />))
    expect(host.textContent).toContain('执行中 · 已耗时 4.00 秒')
    expect(host.textContent).toContain('上下文整理 7 ms')
    await act(async () =>
      root.render(<AgentActivityTimeline compact events={[requested, { seq: 2, type: 'model.completed', data: { model: 'local', durationMs: 4000, text: 'done' } }]} />)
    )
    expect(host.textContent).toContain('模型请求耗时 4.00 秒')
    expect(host.textContent).not.toContain('执行中')
    await act(async () => jest.advanceTimersByTime(3000))
    expect(host.textContent).toContain('模型请求耗时 4.00 秒')
  } finally {
    jest.useRealTimers()
  }
})
