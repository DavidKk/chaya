import { notifyAgentAuthChange } from '@/services/game-agent/cli/auth-change.server'
import { disposeWarmCli, WARM_IDLE_MS, WARM_MAX_IDLE, withWarmCli } from '@/services/game-agent/cli/warm-pool.server'

function handle(id: number) {
  let alive = true
  const dispose = jest.fn(() => {
    alive = false
  })
  return { value: id, alive: () => alive, dispose, kill: () => (alive = false) }
}

const target = { key: 'cursor:p1:', profileId: 'p1', provider: 'cursor' }

afterEach(() => {
  disposeWarmCli()
  jest.useRealTimers()
})

test('an idle process closes after five minutes and the next call starts a new one', async () => {
  jest.useFakeTimers()
  const first = handle(1)
  const create = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(handle(2))
  expect(WARM_IDLE_MS).toBe(5 * 60_000)
  expect(create).not.toHaveBeenCalled()
  await withWarmCli(target, create, async (value) => value)
  await jest.advanceTimersByTimeAsync(WARM_IDLE_MS - 1)
  expect(first.dispose).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(1)
  expect(first.dispose).toHaveBeenCalledTimes(1)
  expect(await withWarmCli(target, create, async (value) => value)).toBe(2)
  expect(create).toHaveBeenCalledTimes(2)
})

test('reuse restarts the idle countdown and a busy round cannot expire', async () => {
  jest.useFakeTimers()
  const first = handle(1)
  const create = jest.fn().mockResolvedValue(first)
  await withWarmCli(target, create, async (value) => value)
  await jest.advanceTimersByTimeAsync(WARM_IDLE_MS - 1)
  await withWarmCli(target, create, async (value) => value)
  await jest.advanceTimersByTimeAsync(WARM_IDLE_MS - 1)
  expect(first.dispose).not.toHaveBeenCalled()
  await withWarmCli(target, create, async (value) => {
    await jest.advanceTimersByTimeAsync(WARM_IDLE_MS * 2)
    expect(first.dispose).not.toHaveBeenCalled()
    return value
  })
  await jest.advanceTimersByTimeAsync(WARM_IDLE_MS)
  expect(first.dispose).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(1)
})

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

test('the global idle limit evicts the least recently used process across providers', async () => {
  const first = handle(1)
  const second = handle(2)
  const third = handle(3)
  const other = { key: 'codex:p2', profileId: 'p2', provider: 'codex' }
  const newest = { key: 'cursor:p3', profileId: 'p3', provider: 'cursor' }
  expect(WARM_MAX_IDLE).toBe(2)
  await withWarmCli(
    target,
    async () => first,
    async (value) => value
  )
  await withWarmCli(
    other,
    async () => second,
    async (value) => value
  )
  await withWarmCli(
    target,
    async () => handle(99),
    async (value) => value
  )
  await withWarmCli(
    newest,
    async () => third,
    async (value) => value
  )
  await Promise.resolve()
  expect(first.dispose).not.toHaveBeenCalled()
  expect(second.dispose).toHaveBeenCalledTimes(1)
  expect(third.dispose).not.toHaveBeenCalled()
})

test('a new configuration replaces only idle processes belonging to the same instance', async () => {
  const first = handle(1)
  const busy = handle(2)
  const replacement = handle(3)
  const changed = { ...target, key: `${target.key}:new-proxy` }
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const running = withWarmCli(
    target,
    async () => busy,
    async () => gate
  )
  await withWarmCli(
    target,
    async () => first,
    async (value) => value
  )
  await withWarmCli(
    changed,
    async () => replacement,
    async (value) => value
  )
  expect(first.dispose).toHaveBeenCalledTimes(1)
  expect(busy.dispose).not.toHaveBeenCalled()
  release()
  await running
  // Either completed configuration may stay warm, but the instance never retains both.
  expect(replacement.dispose).toHaveBeenCalledTimes(1)
  expect(busy.dispose).not.toHaveBeenCalled()
})

test('eviction clears the old timer without affecting the replacement', async () => {
  jest.useFakeTimers()
  const first = handle(1)
  const replacement = handle(2)
  await withWarmCli(
    target,
    async () => first,
    async (value) => value
  )
  await jest.advanceTimersByTimeAsync(WARM_IDLE_MS - 1)
  await withWarmCli(
    { ...target, key: `${target.key}:changed` },
    async () => replacement,
    async (value) => value
  )
  await jest.advanceTimersByTimeAsync(1)
  expect(first.dispose).toHaveBeenCalledTimes(1)
  expect(replacement.dispose).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(WARM_IDLE_MS - 1)
  expect(replacement.dispose).toHaveBeenCalledTimes(1)
})
