import { clearDownloadJobsForTest, findRunningJob, type JobEvent, listDownloadJobs, startDownloadJob, subscribeDownloadJobs } from '@/services/downloads/jobs'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

afterEach(() => {
  clearDownloadJobsForTest()
  jest.useRealTimers()
})

test('成功：记 done 并带结果', async () => {
  const { job, done } = startDownloadJob('nw-shell', async () => ({ version: 'v1' }))
  expect(job.status).toBe('running')
  const finished = await done
  expect(finished).toMatchObject({ status: 'done', result: { version: 'v1' } })
  expect(finished.finishedAt).toBeDefined()
})

test('失败：记 error 与原因', async () => {
  const { done } = startDownloadJob('nw-shell', async () => {
    throw new Error('网络断了')
  })
  expect(await done).toMatchObject({ status: 'error', error: '网络断了' })
})

test('同种类重复发起返回运行中的任务', async () => {
  const gate = deferred()
  const first = startDownloadJob('nw-shell', async () => gate.promise)
  const second = startDownloadJob('nw-shell', async () => ({}))
  expect(second.reused).toBe(true)
  expect(second.job.id).toBe(first.job.id)
  expect(findRunningJob('nw-shell')?.id).toBe(first.job.id)
  gate.resolve()
  await first.done
  expect(findRunningJob('nw-shell')).toBeUndefined()
})

test('进度节流 250 ms；阶段变化与结束立即推送', async () => {
  jest.useFakeTimers()
  const events: JobEvent[] = []
  subscribeDownloadJobs((e) => events.push(e))
  const gate = deferred()
  let ctl!: { update: (p: { phase?: 'download'; receivedBytes?: number }) => void }
  const { done } = startDownloadJob('nw-shell', async ({ update }) => {
    ctl = { update }
    await gate.promise
  })
  expect(events).toHaveLength(1)

  ctl.update({ phase: 'download', receivedBytes: 1 })
  expect(events).toHaveLength(2)
  ctl.update({ receivedBytes: 2 })
  ctl.update({ receivedBytes: 3 })
  expect(events).toHaveLength(2)
  jest.advanceTimersByTime(250)
  expect(events).toHaveLength(3)
  expect(events[2]).toMatchObject({ type: 'job', job: { receivedBytes: 3 } })

  gate.resolve()
  await done
  expect(events.at(-1)).toMatchObject({ type: 'job', job: { status: 'done' } })
})

test('超过 20 条结束任务时淘汰最早的并推 removed', async () => {
  const removed: string[] = []
  subscribeDownloadJobs((e) => {
    if (e.type === 'removed') removed.push(e.id)
  })
  const ids: string[] = []
  for (let i = 0; i < 21; i++) {
    const { job, done } = startDownloadJob('nw-shell', async () => ({}))
    ids.push(job.id)
    await done
    await new Promise((r) => setTimeout(r, 2))
  }
  expect(listDownloadJobs()).toHaveLength(20)
  expect(removed).toEqual([ids[0]])
})
