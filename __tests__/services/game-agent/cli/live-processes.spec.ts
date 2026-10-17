import {
  formatCommandText,
  formatEnvText,
  inferProcessLabel,
  killLiveAgentProcess,
  pickTrackedEnv,
  proxyReportFromEnv,
  resetLiveAgentProcessesForTests,
  trackLiveAgentProcess,
} from '@/services/game-agent/cli/live-processes.server'

afterEach(() => {
  resetLiveAgentProcessesForTests()
})

describe('proxyReportFromEnv', () => {
  it('marks proxy complete when HTTP/HTTPS/ALL/FTP are set', () => {
    expect(
      proxyReportFromEnv({
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        ALL_PROXY: 'http://127.0.0.1:7890',
        FTP_PROXY: 'http://127.0.0.1:7890',
      })
    ).toMatchObject({ complete: true, slotsMissing: [] })
  })

  it('lists missing slots', () => {
    expect(proxyReportFromEnv({ HTTP_PROXY: 'http://127.0.0.1:7890' })).toMatchObject({
      complete: false,
      slotsFilled: ['HTTP_PROXY'],
      slotsMissing: ['HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY'],
    })
  })
})

describe('format helpers', () => {
  it('formats command with indented args', () => {
    expect(formatCommandText('/bin/agy', ['--login', 'google'])).toBe('/bin/agy\n  --login\n  google')
  })

  it('formats env as sorted KEY=value lines', () => {
    expect(formatEnvText({ B: '2', A: '1' })).toBe('A=1\nB=2')
  })
})

describe('inferProcessLabel', () => {
  it('recognizes Codex / Gemini / Cursor / Claude CLIs', () => {
    expect(inferProcessLabel('/usr/local/bin/codex', [])).toContain('Codex')
    expect(inferProcessLabel('/Users/me/.local/bin/agy', [])).toContain('Gemini')
    expect(inferProcessLabel('/Users/me/.local/bin/agent', [])).toContain('Cursor')
    expect(inferProcessLabel('node', ['/x/claude-agent-acp/index.js'])).toContain('Claude')
  })
})

describe('trackLiveAgentProcess', () => {
  it('rejects a forged system process id without sending a signal', async () => {
    const kill = jest.spyOn(process, 'kill')
    await expect(killLiveAgentProcess(`system-${process.pid}`)).resolves.toMatchObject({ ok: false })
    expect(kill).not.toHaveBeenCalled()
  })
  it('redacts secrets and keeps proxy values', () => {
    const watch = trackLiveAgentProcess({
      kind: 'stdio',
      pid: process.pid,
      file: '/Users/me/.local/bin/agy',
      args: [],
      cwd: '/tmp',
      env: {
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        ALL_PROXY: 'http://127.0.0.1:7890',
        FTP_PROXY: 'http://127.0.0.1:7890',
        OPENAI_API_KEY: 'sk-secret',
        HOME: '/Users/me',
      },
    })
    expect(pickTrackedEnv({ OPENAI_API_KEY: 'sk', HOME: '/tmp' })).toEqual({ OPENAI_API_KEY: '***', HOME: '/tmp' })
    watch.dispose()
  })

  it('pickTrackedEnv ignores empty values', () => {
    expect(pickTrackedEnv({ HTTP_PROXY: '', HOME: '/tmp' })).toEqual({ HOME: '/tmp' })
  })
})
