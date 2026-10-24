/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { UnsavedChangesProvider, useUnsavedChanges } from '@/components/confirm/UnsavedChangesProvider'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import type { AgentSettings } from '@/components/settings/agent-types'
import { AgentSettingsView } from '@/components/settings/AgentSettingsView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

const initialSettings: AgentSettings = {
  version: 1,
  defaultProfileId: 'ollama-local',
  profiles: [
    {
      id: 'ollama-local',
      label: 'Local Ollama',
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      defaultModel: 'qwen3',
      temperature: 0.7,
      keepAlive: '10m',
      modelRequestTimeoutMs: 10_000,
      modelTimeoutMs: 120_000,
      gameCallTimeoutMs: 15_000,
      proxy: '',
      proxyProtocols: {},
      proxyHeaders: {},
    },
  ],
}

function TestDirtyComponent({ dirty, onAttemptLeave }: { dirty: boolean; onAttemptLeave: () => void }) {
  const { confirmIfDirty } = useUnsavedChanges(dirty)
  return (
    <div>
      <a href="/other-page" data-testid="nav-link">
        Link to other
      </a>
      <button
        type="button"
        data-testid="leave-btn"
        onClick={async () => {
          if (await confirmIfDirty()) {
            onAttemptLeave()
          }
        }}
      >
        Leave
      </button>
    </div>
  )
}

describe('UnsavedChangesProvider and useUnsavedChanges', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    host.remove()
  })

  it('allows navigation when not dirty without confirming', async () => {
    const onLeave = jest.fn()
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <ConfirmProvider>
            <UnsavedChangesProvider>
              <TestDirtyComponent dirty={false} onAttemptLeave={onLeave} />
            </UnsavedChangesProvider>
          </ConfirmProvider>
        </LocaleProvider>
      )
    })

    const leaveBtn = host.querySelector<HTMLButtonElement>('[data-testid="leave-btn"]')!
    await act(async () => leaveBtn.click())

    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('未保存的修改')
    await act(async () => root.unmount())
  })

  it('prompts confirm dialog when dirty; cancelling stays, confirming leaves', async () => {
    const onLeave = jest.fn()
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <ConfirmProvider>
            <UnsavedChangesProvider>
              <TestDirtyComponent dirty={true} onAttemptLeave={onLeave} />
            </UnsavedChangesProvider>
          </ConfirmProvider>
        </LocaleProvider>
      )
    })

    const leaveBtn = host.querySelector<HTMLButtonElement>('[data-testid="leave-btn"]')!
    await act(async () => leaveBtn.click())

    // Dialog appears
    expect(document.body.textContent).toContain('未保存的修改')
    expect(document.body.textContent).toContain('当前表单有未保存的修改')
    expect(onLeave).not.toHaveBeenCalled()

    // Click "继续编辑" (Cancel)
    const cancelBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((btn) => btn.textContent?.includes('继续编辑'))!
    await act(async () => cancelBtn.click())

    expect(onLeave).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('未保存的修改')

    // Click leave again and confirm this time
    await act(async () => leaveBtn.click())
    const confirmBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((btn) => btn.textContent?.includes('放弃修改并离开'))!
    await act(async () => confirmBtn.click())

    expect(onLeave).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('intercepts clicks on anchor navigation links when dirty', async () => {
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <ConfirmProvider>
            <UnsavedChangesProvider>
              <TestDirtyComponent dirty={true} onAttemptLeave={() => {}} />
            </UnsavedChangesProvider>
          </ConfirmProvider>
        </LocaleProvider>
      )
    })

    const navLink = host.querySelector<HTMLAnchorElement>('[data-testid="nav-link"]')!
    await act(async () => navLink.click())

    // Dialog appears
    expect(document.body.textContent).toContain('未保存的修改')
    await act(async () => root.unmount())
  })

  it('protects AgentSettingsView from leaving when edited without saving', async () => {
    const onNavigate = jest.fn()
    const request = jest.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ settings: initialSettings, sync: null }),
        }) as Response
    )

    const root = createRoot(host)
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <NotificationProvider>
            <ConfirmProvider>
              <UnsavedChangesProvider>
                <AgentSettingsView request={request} agentId="ollama-local" onNavigate={onNavigate} />
              </UnsavedChangesProvider>
            </ConfirmProvider>
          </NotificationProvider>
        </LocaleProvider>
      )
    })

    // Modify profile name
    const labelInput = host.querySelector<HTMLInputElement>('input[value="Local Ollama"]')!
    await act(async () => {
      labelInput.value = 'Modified Ollama'
      labelInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Find and click the Back button
    const backBtn = [...host.querySelectorAll<HTMLButtonElement>('button')].find((btn) => btn.textContent?.includes('返回'))!
    await act(async () => backBtn.click())

    // Confirmation dialog pops up
    expect(document.body.textContent).toContain('未保存的修改')
    expect(onNavigate).not.toHaveBeenCalled()

    // Click "继续编辑" -> should remain on edit page
    const cancelBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((btn) => btn.textContent?.includes('继续编辑'))!
    await act(async () => cancelBtn.click())
    expect(onNavigate).not.toHaveBeenCalled()

    // Click "返回" again and click "放弃修改并离开"
    await act(async () => backBtn.click())
    const confirmBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((btn) => btn.textContent?.includes('放弃修改并离开'))!
    await act(async () => confirmBtn.click())

    // Successfully navigated back
    expect(onNavigate).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
  })
})
