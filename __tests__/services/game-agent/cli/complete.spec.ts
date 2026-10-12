import { completeWithCli } from '@/services/game-agent/cli/complete.server'
import { AgentCliError } from '@/services/game-agent/cli/errors'

const runAntigravityPrompt = jest.fn<Promise<string>, [string, unknown]>()
const requireCli = jest.fn<Promise<string>, [string]>(async () => '/bin/agy')
const agentProxyEnv = jest.fn<Promise<Record<string, string>>, [string | undefined]>(async () => ({ HTTPS_PROXY: 'http://127.0.0.1:7890' }))
const release = jest.fn(async () => undefined)
const remove = jest.fn()
const markCredentialsExpired = jest.fn<void, [string, number]>()

jest.mock('@/services/game-agent/cli/antigravity.server', () => ({
  ANTIGRAVITY_SETTINGS: '{}',
  ANTIGRAVITY_SETTINGS_PATH: '.gemini/antigravity-cli/settings.json',
  antigravityEnv: (_file: string, home: string, extra: Record<string, string>) => ({ HOME: home, ...extra }),
  get runAntigravityPrompt() {
    return runAntigravityPrompt
  },
}))

jest.mock('@/services/game-agent/cli/resolve-cli.server', () => ({
  get requireCli() {
    return requireCli
  },
  resolveCli: jest.fn(),
}))

jest.mock('@/services/game-agent/proxy/agent-proxy', () => ({
  get agentProxyEnv() {
    return agentProxyEnv
  },
}))

jest.mock('@/services/game-agent/cli/credentials/runtime-dir.server', () => ({
  acquireCredentialLease: jest.fn(async () => ({ dir: '/tmp/chaya-gemini-test', generation: 1, sync: jest.fn(), release })),
  createOnceCwd: () => ({ dir: '/tmp/chaya-gemini-cwd', remove }),
}))

jest.mock('@/services/game-agent/cli/credentials/store.server', () => ({
  get markCredentialsExpired() {
    return markCredentialsExpired
  },
}))

const profile = { id: 'gemini-1', provider: 'gemini' as const, proxy: 'http://127.0.0.1:7890' }
const input = { model: 'gemini-3.8-flash-low', messages: [{ role: 'user' as const, content: 'hi' }], tools: [], timeoutMs: 30_000 }

beforeEach(() => {
  jest.clearAllMocks()
})

test('Gemini retries once after a one-off CLI crash', async () => {
  runAntigravityPrompt.mockRejectedValueOnce(new Error('Malformed function call')).mockResolvedValueOnce('{"reply":"ok"}')
  await expect(completeWithCli(profile, input)).resolves.toMatchObject({ role: 'assistant', content: 'ok' })
  expect(runAntigravityPrompt).toHaveBeenCalledTimes(2)
  expect(release).toHaveBeenCalledTimes(1)
})

test('Gemini does not retry auth or quota failures', async () => {
  runAntigravityPrompt.mockRejectedValueOnce(new AgentCliError('AGENT_AUTH_EXPIRED', '授权已失效'))
  await expect(completeWithCli(profile, input)).rejects.toMatchObject({ code: 'AGENT_AUTH_EXPIRED' })
  expect(runAntigravityPrompt).toHaveBeenCalledTimes(1)
  expect(markCredentialsExpired).toHaveBeenCalledWith('gemini-1', 1)
})

test('Gemini does not retry when the request was aborted', async () => {
  const signal = AbortSignal.abort()
  runAntigravityPrompt.mockRejectedValueOnce(new Error('Malformed function call'))
  await expect(completeWithCli(profile, { ...input, signal })).rejects.toMatchObject({
    code: 'AGENT_CLI_CRASHED',
    message: expect.stringContaining('Malformed function call'),
  })
  expect(runAntigravityPrompt).toHaveBeenCalledTimes(1)
})
