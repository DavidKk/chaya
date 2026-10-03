import { GET as LIST } from '@/app/api/downloads/route.server'
import { GET as STREAM } from '@/app/api/downloads/stream/route.server'
import { DELETE as DEL_SHELL, POST as POST_SHELL } from '@/app/api/shell/route.server'
import * as diskOps from '@/services/disk-ops'
import { clearDownloadJobsForTest } from '@/services/downloads/jobs'

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/game/nw-update', () => ({ getNwShellUpdate: jest.fn() }))
jest.mock('@/services/disk-ops', () => ({
  requireDisk: jest.fn(() => null),
  getResolvedFromConfig: jest.fn(() => ({ ok: true, remote: false, contentRoot: '/game/www', config: {} })),
  installShell: jest.fn(async () => ({ shellApp: '/shell', contentLink: '/game/www', created: true, relinked: false })),
  saveConfig: jest.fn(() => ({})),
  isToolkitShellInstalled: jest.fn(() => true),
  uninstallToolkitShell: jest.fn(() => ({ removed: ['/shell'] })),
}))

type Gate = { release: () => void; fail: (e: Error) => void }
const gates: Gate[] = []
jest.mock('@/services/game/shell-job', () => ({
  startLatestShellJob: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/services/downloads/jobs') as typeof import('@/services/downloads/jobs')).startDownloadJob('nw-shell', ({ signal, update }) => {
      update({ phase: 'download', version: 'v9' })
      return new Promise((resolve, reject) => {
        gates.push({ release: () => resolve({ shellApp: '/shell' }), fail: reject })
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    }),
}))

const ctx = { params: Promise.resolve({}) }
const postShell = (body: unknown) => POST_SHELL(new Request('http://localhost/api/shell', { method: 'POST', body: JSON.stringify(body) }), ctx)

afterEach(() => {
  clearDownloadJobsForTest()
  gates.splice(0)
})

test('fetchLatest 立即 202，重复发起返回同一任务', async () => {
  const first = await postShell({ fetchLatest: true })
  expect(first.status).toBe(202)
  const a = await first.json()
  expect(a).toMatchObject({ ok: true, reused: false, job: { kind: 'nw-shell', status: 'running' } })

  const b = await (await postShell({ fetchLatest: true })).json()
  expect(b).toMatchObject({ reused: true, job: { id: a.job.id } })

  const list = await (await LIST(new Request('http://localhost/api/downloads'), ctx)).json()
  expect(list.jobs).toHaveLength(1)
})

test('wait: true 等任务结束：成功 200，失败 400', async () => {
  const pending = postShell({ fetchLatest: true, wait: true })
  await new Promise((r) => setTimeout(r, 0))
  gates[0].release()
  const ok = await pending
  expect(ok.status).toBe(200)
  expect(await ok.json()).toMatchObject({ shellApp: '/shell', job: { status: 'done' } })

  const failing = postShell({ fetchLatest: true, wait: true })
  await new Promise((r) => setTimeout(r, 0))
  gates[1].fail(new Error('网络断了'))
  const bad = await failing
  expect(bad.status).toBe(400)
  expect((await bad.json()).error.message).toBe('网络断了')
})

test('任务运行中：指定壳源安装与卸载返回 409', async () => {
  await postShell({ fetchLatest: true })
  const install = await postShell({ shellSource: '/nw' })
  expect(install.status).toBe(409)
  expect((await install.json()).error.code).toBe('SHELL_JOB_RUNNING')
  const uninstall = await DEL_SHELL(new Request('http://localhost/api/shell', { method: 'DELETE' }), ctx)
  expect(uninstall.status).toBe(409)
  expect(diskOps.installShell).not.toHaveBeenCalled()
  expect(diskOps.uninstallToolkitShell).not.toHaveBeenCalled()
})

test('SSE 首帧为 snapshot，之后推 job', async () => {
  await postShell({ fetchLatest: true })
  const abort = new AbortController()
  const res = await STREAM(new Request('http://localhost/api/downloads/stream', { signal: abort.signal }), ctx)
  expect(res.headers.get('Content-Type')).toContain('text/event-stream')
  expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  const reader = res.body!.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  expect(first).toMatch(/^event: snapshot\ndata: \{"jobs":\[\{/)

  gates[0].release()
  const next = new TextDecoder().decode((await reader.read()).value)
  expect(next).toContain('event: job')
  expect(next).toContain('"status":"done"')
  abort.abort()
  await reader.cancel()
})
