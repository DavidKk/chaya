import { createModelGate } from '@/plugins/src/agent/runtime/model-gate'

it('runs model requests one at a time', async () => {
  const gate = createModelGate()
  const order: string[] = []
  let release = () => {}
  const first = gate.run(() => new Promise<void>((resolve) => (release = () => (order.push('first'), resolve()))))
  const second = gate.run(async () => void order.push('second'))
  await Promise.resolve()
  expect(order).toEqual([])
  release()
  await Promise.all([first, second])
  expect(order).toEqual(['first', 'second'])
})

it('reuses a model failure during the cooldown and lets requests through after it or a success', async () => {
  let now = 0
  const gate = createModelGate(15_000, () => now)
  const task = jest.fn(async () => 'ok')
  gate.trip(new Error('无法连接 Ollama'))
  await expect(gate.run(task)).rejects.toThrow('无法连接 Ollama')
  expect(task).not.toHaveBeenCalled()
  now = 15_000
  await expect(gate.run(task)).resolves.toBe('ok')
  gate.trip(new Error('again'))
  gate.reset()
  await expect(gate.run(task)).resolves.toBe('ok')
  expect(task).toHaveBeenCalledTimes(2)
})
