/** @jest-environment jsdom */
import { type BrowserTaskControl, type BrowserTaskHandle, resetBrowserTasksForTest, startBrowserDownload } from '@/lib/downloads/browser-tasks'
import { getDownloadActions, getDownloads, LOCAL_FINISHED_TTL_MS, resetDownloadsForTest } from '@/lib/downloads/store'

type Held = { name: string; release: () => void }

/** 极简 Web Locks：同名锁 ifAvailable 时拿不到即返回 null */
function installFakeLocks() {
  const held = new Map<string, Held>()
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      async request(name: string, _opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) {
        if (held.has(name)) return cb(null)
        held.set(name, { name, release: () => {} })
        try {
          await cb({ name })
        } finally {
          held.delete(name)
        }
      },
    },
  })
}

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const spec = (run: (ctl: BrowserTaskControl) => Promise<void>, gameId = 'g1') => ({ kind: 'nw-shell' as const, gameId, gameName: 'Game', lockKey: `chaya-shell:${gameId}`, run })
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetDownloadsForTest()
  resetBrowserTasksForTest()
  installFakeLocks()
})

test('拿到游戏锁后立即返回任务 ID；同一游戏再发起返回 locked', async () => {
  const gate = deferred()
  const first = (await startBrowserDownload(spec(() => gate.promise))) as BrowserTaskHandle
  expect(first.id).toMatch(/^web:/)
  expect(getDownloads()[0]).toMatchObject({ status: 'running', gameId: 'g1' })
  await expect(startBrowserDownload(spec(async () => {}))).resolves.toEqual({ error: 'locked' })
  gate.resolve()
  expect((await first.done).status).toBe('done')
})

test('标签页内读写排队：后来的任务显示 queued，按顺序出队', async () => {
  const gateA = deferred()
  const order: string[] = []
  const a = (await startBrowserDownload(
    spec(async (ctl) => {
      const release = await ctl.enterIoQueue()
      order.push('a')
      await gateA.promise
      release()
    }, 'a')
  )) as BrowserTaskHandle
  await flush()
  const b = (await startBrowserDownload(
    spec(async (ctl) => {
      const release = await ctl.enterIoQueue()
      order.push('b')
      release()
    }, 'b')
  )) as BrowserTaskHandle
  const c = (await startBrowserDownload(
    spec(async (ctl) => {
      const release = await ctl.enterIoQueue()
      order.push('c')
      release()
    }, 'c')
  )) as BrowserTaskHandle
  await flush()
  expect(getDownloads().find((i) => i.id === b.id)?.phase).toBe('queued')

  expect(getDownloads().find((i) => i.id === c.id)?.phase).toBe('queued')
  gateA.resolve()
  await Promise.all([a.done, b.done, c.done])
  expect(order).toEqual(['a', 'b', 'c'])
})

test('等待选文件：挂上 pickFile，选中后继续并清掉步骤', async () => {
  const picked = deferred<string>()
  const task = (await startBrowserDownload(
    spec(async (ctl) => {
      const file = await ctl.waitForFile({ archiveName: 'nw.zip', openDownload: () => {}, pickFile: async () => 'file.zip' })
      picked.resolve(file)
    })
  )) as BrowserTaskHandle
  await flush()
  expect(getDownloads()[0]).toMatchObject({ phase: 'awaitFile', archiveName: 'nw.zip' })
  await getDownloadActions(task.id)!.pickFile!()
  await expect(picked.promise).resolves.toBe('file.zip')
  expect(getDownloadActions(task.id)?.pickFile).toBeUndefined()
  expect((await task.done).status).toBe('done')
})

test('选文件框被关闭：任务继续等待', async () => {
  let calls = 0
  const task = (await startBrowserDownload(
    spec(async (ctl) => {
      await ctl.waitForFile({
        archiveName: 'nw.zip',
        openDownload: () => {},
        pickFile: async () => {
          calls += 1
          if (calls === 1) throw new DOMException('closed', 'AbortError')
          return 'ok'
        },
      })
    })
  )) as BrowserTaskHandle
  await flush()
  await getDownloadActions(task.id)!.pickFile!()
  expect(getDownloads()[0]).toMatchObject({ status: 'running', phase: 'awaitFile' })
  await getDownloadActions(task.id)!.pickFile!()
  expect((await task.done).status).toBe('done')
})

test('选错文件：错误抛给界面，任务停在等待选文件', async () => {
  const task = (await startBrowserDownload(
    spec(async (ctl) => {
      await ctl.waitForFile({
        archiveName: 'nw.zip',
        openDownload: () => {},
        pickFile: async () => {
          throw new Error('请选择 nw.zip')
        },
      })
    })
  )) as BrowserTaskHandle
  await flush()
  await expect(getDownloadActions(task.id)!.pickFile!()).rejects.toThrow('请选择 nw.zip')
  expect(getDownloads()[0]).toMatchObject({ status: 'running', phase: 'awaitFile' })
})

test('放弃等待选文件：任务以 canceled 结束、清掉步骤并释放游戏锁', async () => {
  let after = false
  const task = (await startBrowserDownload(
    spec(async (ctl) => {
      await ctl.waitForFile({ archiveName: 'nw.zip', openDownload: () => {}, pickFile: async () => 'ok' })
      after = true
    })
  )) as BrowserTaskHandle
  await flush()
  await getDownloadActions(task.id)!.abandon!()
  expect((await task.done).status).toBe('canceled')
  expect(after).toBe(false)
  expect(getDownloadActions(task.id)?.pickFile).toBeUndefined()
  await flush()
  expect('id' in (await startBrowserDownload(spec(async () => {})))).toBe(true)
})

test('失败记 error，一小时后自动从列表移除', async () => {
  jest.useFakeTimers()
  try {
    const task = (await startBrowserDownload(
      spec(async () => {
        throw new Error('写入失败')
      })
    )) as BrowserTaskHandle
    expect(await task.done).toMatchObject({ status: 'error', error: '写入失败' })
    expect(getDownloadActions(task.id)).toEqual({})
    jest.advanceTimersByTime(LOCAL_FINISHED_TTL_MS)
    expect(getDownloads()).toEqual([])
  } finally {
    jest.useRealTimers()
  }
})
