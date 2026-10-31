// pnpm exec tsx scripts/tools/companion-service-smoke.cts <output-dir>
// Actual service scheduler and resident Ollama; does not start or unload a model daemon.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

async function main() {
  const output = path.resolve(process.argv[2] || '/tmp/chaya-companion-service-smoke')
  await fs.mkdir(output, { recursive: true })
  process.env.CHAYA_DATA_DIR = await fs.mkdtemp(path.join(output, 'runtime-data-'))
  const { completeCompanionModel } = await import('@/services/game-agent/companion-model.server')
  const { COMPANION_RESOURCE_SETTINGS_PATH } = await import('@/services/game-agent/companion-resource-settings.server')
  const { normalizeGameAgentProfile } = await import('@/services/game-agent/settings')
  const profile = normalizeGameAgentProfile({
    id: 'service-acceptance',
    provider: 'ollama',
    endpoint: process.env.CHAYA_SMOKE_OLLAMA || 'http://127.0.0.1:11434',
    defaultModel: process.env.CHAYA_SMOKE_MODEL || 'qwen3:4b-instruct-2507-q4_K_M',
  })
  const trace: Array<Record<string, any>> = []
  const policy = async (capacity: number) => {
    await fs.mkdir(path.dirname(COMPANION_RESOURCE_SETTINGS_PATH), { recursive: true })
    await fs.writeFile(
      COMPANION_RESOURCE_SETTINGS_PATH,
      JSON.stringify({
        resources: { 'local-inference': { capacity, maxRunningPerInstance: capacity, maxQueuedPerInstance: 4 } },
      })
    )
  }
  const request = (id: string, token: string, signal = new AbortController().signal) =>
    completeCompanionModel(profile, {
      requestId: id,
      model: profile.defaultModel,
      purpose: 'companion-chat',
      messages: [{ role: 'user', content: `Reply with exactly this word and nothing else: ${token}` }],
      conversationKey: JSON.stringify(['companion', `instance-${id}`, profile.id, profile.defaultModel, id]),
      maxTokens: 32,
      signal,
      onEvent: (event) => {
        trace.push({ ...event, at: Date.now() })
      },
    })
  try {
    await policy(1)
    const serial = await Promise.all([request('serial-a', 'APPLE'), request('serial-b', 'BANANA')])
    assert(serial[0].content.includes('APPLE'))
    assert(serial[1].content.includes('BANANA'))
    const queued = trace.find((e) => e.type === 'queued' && e.requestId === 'serial-b')
    assert(queued, 'Capacity one queues the second actual generation')
    const endA = trace.find((e) => e.type === 'completed' && e.requestId === 'serial-a')!
    const startB = trace.find((e) => e.type === 'started' && e.requestId === 'serial-b')!
    assert(startB.at >= endA.at, 'Second upstream generation starts after first settles')
    process.stdout.write('capacity-one-passed\n')

    await policy(2)
    const parallel = await Promise.all([request('parallel-a', 'ORANGE'), request('parallel-b', 'PEACH')])
    assert(parallel[0].content.includes('ORANGE') && !parallel[0].content.includes('PEACH'))
    assert(parallel[1].content.includes('PEACH') && !parallel[1].content.includes('ORANGE'))
    const startTimes = ['parallel-a', 'parallel-b'].map((id) => trace.find((e) => e.requestId === id && e.type === 'started')!.at)
    const endTimes = ['parallel-a', 'parallel-b'].map((id) => trace.find((e) => e.requestId === id && e.type === 'completed')!.at)
    assert(Math.max(...startTimes) < Math.min(...endTimes), 'Capacity two overlaps actual upstream requests')
    process.stdout.write('capacity-two-request-overlap-passed\n')

    await policy(1)
    const cancel = new AbortController()
    const cancelled = request('cancel-a', 'PINEAPPLE', cancel.signal).then(
      () => ({ code: 'unexpected-success' }),
      (error) => error.error || { code: String(error) }
    )
    const survivor = request('cancel-b', 'MANGO')
    cancel.abort()
    assert.equal((await cancelled).code, 'CANCELLED')
    assert((await survivor).content.includes('MANGO'))
    assert(!trace.some((e) => e.requestId === 'cancel-a' && e.type === 'completed'), 'Cancelled request cannot publish completion')
    process.stdout.write('isolated-cancellation-passed\n')
    await fs.writeFile(
      path.join(output, 'summary.json'),
      JSON.stringify(
        {
          capacityOne: 'passed',
          capacityTwoUpstreamRequests: 'passed',
          independentConversations: 'passed',
          isolatedCancellation: 'passed',
          backendTokenParallelism: 'unmeasured; daemon may serialize inference',
        },
        null,
        2
      ) + '\n'
    )
  } finally {
    await fs.writeFile(path.join(output, 'trace.json'), JSON.stringify(trace, null, 2) + '\n')
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
