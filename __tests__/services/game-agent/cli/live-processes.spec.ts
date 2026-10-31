import {
  formatCommandText,
  formatEnvText,
  inferProcessLabel,
  killLiveAgentProcess,
  looksLikeAgentCli,
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

describe('looksLikeAgentCli', () => {
  it.each([
    '/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer)',
    '/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/browser_crashpad_handler',
    '/Users/me/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService',
    '/Applications/Codex.app/Contents/MacOS/Codex',
  ])('excludes desktop application processes: %s', (file) => {
    expect(looksLikeAgentCli(file, `${file} --type=renderer`)).toBe(false)
  })

  it.each([
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Users/me/Library/Application Support/Cursor/agent-cli/.local/bin/cursor-agent',
    '/Users/me/.local/bin/agent',
    'C:\\Program Files\\Codex\\codex.exe',
    '/usr/local/bin/gemini',
  ])('recognizes CLI executables including paths with spaces: %s', (file) => {
    expect(looksLikeAgentCli(file, `${file} app-server`)).toBe(true)
  })

  it('recognizes node CLI scripts but ignores provider names in arbitrary arguments', () => {
    expect(looksLikeAgentCli('/usr/bin/node', 'node /x/claude-agent-acp/index.js')).toBe(true)
    expect(looksLikeAgentCli('/usr/bin/node', 'node /x/@openai/codex/bin/codex.js app-server')).toBe(true)
    expect(looksLikeAgentCli('/usr/bin/node', 'node /x/server.js --model codex')).toBe(false)
    expect(looksLikeAgentCli('/usr/bin/node', 'node /Users/me/Library/Application Support/Codex/runtime/host-daemon.mjs')).toBe(false)
    expect(looksLikeAgentCli('/usr/bin/python', 'python /x/codex')).toBe(false)
    expect(looksLikeAgentCli('/usr/bin/agent')).toBe(false)
    expect(looksLikeAgentCli('agent', '/home/me/.local/bin/agent acp')).toBe(true)
    expect(looksLikeAgentCli('agent', '/usr/bin/agent --model cursor')).toBe(false)
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
