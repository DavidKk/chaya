import { notifyAgentAuthChange } from '@/services/game-agent/cli/auth-change.server'
import { disposeWarmCli, withWarmCli } from '@/services/game-agent/cli/warm-pool.server'

function handle(id: number) {
  let alive = true
  const dispose = jest.fn(() => {
    alive = false
  })
  return { value: id, alive: () => alive, dispose, kill: () => (alive = false) }
}

const target = { key: 'cursor:p1:', profileId: 'p1', provider: 'cursor' }

afterEach(() => disposeWarmCli())

test('a finished round parks its process for the next one', async () => {
  const first = handle(1)
  const create = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(handle(2))
  expect(await withWarmCli(target, create, async (value) => value)).toBe(1)
  expect(await withWarmCli(target, create, async (value) => value)).toBe(1)
  expect(create).toHaveBeenCalledTimes(1)
  expect(first.dispose).not.toHaveBeenCalled()
})

test('a failed round or a dead process is never reused', async () => {
  const first = handle(1)
  const second = handle(2)
  const create = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(handle(3))
  await expect(withWarmCli(target, create, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  expect(first.dispose).toHaveBeenCalled()
  await withWarmCli(target, create, async (value) => value)
  second.kill()
  expect(await withWarmCli(target, create, async (value) => value)).toBe(3)
  expect(second.dispose).toHaveBeenCalled()
})

test('concurrent rounds each get a process and only one stays warm', async () => {
  const handles = [handle(1), handle(2)]
  const create = jest.fn().mockResolvedValueOnce(handles[0]).mockResolvedValueOnce(handles[1])
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  const slow = withWarmCli(target, create, async (value) => {
    await gate
    return value
  })
  await new Promise((resolve) => setImmediate(resolve))
  expect(await withWarmCli(target, create, async (value) => value)).toBe(2)
  release()
  expect(await slow).toBe(1)
  expect(handles[0].dispose).toHaveBeenCalled()
  expect(handles[1].dispose).not.toHaveBeenCalled()
})

test('an auth change closes idle processes and keeps a busy one from being parked', async () => {
  const idle = handle(1)
  await withWarmCli(
    target,
    async () => idle,
    async (value) => value
  )
  await notifyAgentAuthChange({ profileId: 'p1' })
  expect(idle.dispose).toHaveBeenCalled()

  const busy = handle(2)
  await withWarmCli(
    target,
    async () => busy,
    async (value) => {
      await notifyAgentAuthChange({ profileId: 'p1' })
      return value
    }
  )
  expect(busy.dispose).toHaveBeenCalled()
})
