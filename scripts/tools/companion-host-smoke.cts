// pnpm exec tsx scripts/tools/companion-host-smoke.cts <game-root> <output-dir> <troop-id> [fixture-json]
// CHAYA_SMOKE_PROFILE_FILE selects an exported agent profile, including its endpoint and model.
// Real model and daemon services, one Electron game; daemon data is isolated, legacy game history may be imported.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'

import { projectHpExperiences } from '@/lib/game-agent/companion/experience'
import type { HpExperience } from '@/lib/game-agent/companion/experience-types'
import type { MemoryStoreSnapshot } from '@/lib/game-agent/companion/memory-types'

import { createSmokeControl } from './companion-smoke-control.cts'
import { createSmokePanels } from './companion-smoke-panels.cts'

async function main() {
  const [rootArg, outputArg, troopArg, fixtureArg] = process.argv.slice(2)
  if (!rootArg || !outputArg || !Number.isInteger(Number(troopArg)) || Number(troopArg) < 1) throw new Error('Expected game root, output directory and positive troop ID')
  const gameRoot = path.resolve(rootArg)
  const output = path.resolve(outputArg)
  const fixture = fixtureArg ? JSON.parse(await fs.readFile(path.resolve(fixtureArg), 'utf8')) : {}
  await fs.mkdir(output, { recursive: true })
  process.env.CHAYA_DATA_DIR = await fs.mkdtemp(path.join(output, 'runtime-data-'))
  const { startStorageDaemon } = await import('@/services/storage/daemon-service.server')
  const { completeCompanionModel } = await import('@/services/game-agent/companion-model.server')
  const { completeAgentModel } = await import('@/services/game-agent/model-complete.server')
  const { normalizeGameAgentProfile } = await import('@/services/game-agent/settings')
  const profile = normalizeGameAgentProfile({
    ...(process.env.CHAYA_SMOKE_PROFILE_FILE
      ? JSON.parse(await fs.readFile(path.resolve(process.env.CHAYA_SMOKE_PROFILE_FILE), 'utf8'))
      : {
          id: 'official-smoke-local',
          provider: 'ollama',
          endpoint: process.env.CHAYA_SMOKE_OLLAMA || 'http://127.0.0.1:11434',
          defaultModel: process.env.CHAYA_SMOKE_MODEL || 'qwen3:4b-instruct-2507-q4_K_M',
        }),
    keepAlive: '-1',
  })
  const daemon = await startStorageDaemon({ dataDir: process.env.CHAYA_DATA_DIR, port: 0 })
  const trace: unknown[] = []
  const managed = ['faults', 'memory', 'panels'].includes(fixture.hostScenario)
  const control = createSmokeControl(daemon, managed, trace)
  const panels = await createSmokePanels(daemon, output, fixture.hostScenario === 'panels')
  const jobs = new Set<AbortController>()
  const service = http.createServer((request, response) => {
    const origin = request.headers.origin
    if (origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    if (fixture.hostScenario === 'panels' && request.url?.startsWith('/__smoke/panels')) {
      void panels.handle(request, response)
      return
    }
    if (request.url === '/__smoke/control' && managed) {
      void control.handle(request, response)
      return
    }
    const legacy = fixture.hostScenario === 'benchmark' && request.url === '/api/game-agent/model'
    if ((!legacy && request.url !== '/api/game-agent/companion-model') || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    const cancel = new AbortController()
    jobs.add(cancel)
    response.on('close', () => cancel.abort())
    const send = (packet: unknown) => {
      if (!response.destroyed) response.write(JSON.stringify(packet) + '\n')
    }
    void (async () => {
      let raw = ''
      for await (const chunk of request) {
        raw += chunk.toString()
        if (raw.length > (legacy ? 1024 * 1024 : 48 * 1024)) throw new Error('Model request too large')
      }
      const body = JSON.parse(raw)
      if (legacy) {
        const id = `legacy-${trace.length}`
        const startedAt = Date.now()
        trace.push({ type: 'legacy-request', requestId: id, at: startedAt, messages: body.messages, toolCount: body.tools?.length })
        try {
          const message = await completeAgentModel(profile, { ...body, signal: cancel.signal })
          trace.push({ type: 'legacy-completed', requestId: id, at: Date.now(), durationMs: Date.now() - startedAt, message })
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message }))
        } catch (error) {
          trace.push({ type: 'legacy-failed', requestId: id, at: Date.now(), durationMs: Date.now() - startedAt, error: String(error) })
          response.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: String(error) } }))
        }
        return
      }
      const fault = control.begin(body, cancel.signal)
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      trace.push({ type: 'request', at: Date.now(), requestId: body.requestId, purpose: body.purpose, messages: body.messages, conversationKey: body.conversationKey })
      let metrics: unknown
      try {
        if (fault?.unavailable) {
          send({ type: 'failed', error: { code: 'MODEL_UNAVAILABLE', message: 'Injected model outage for host acceptance', retryable: true } })
          return
        }
        const message = await completeCompanionModel(profile, {
          ...body,
          think: body.purpose === 'companion-tactic-deep',
          signal: cancel.signal,
          onEvent(event) {
            trace.push({ ...event, at: Date.now() })
            if (event.type === 'completed') {
              metrics = {
                contextMs: event.contextMs,
                queueMs: event.waitedMs,
                startupMs: event.startupMs,
                startupLoadMs: event.startupLoadMs,
                residency: event.residency,
                loadMs: event.loadMs,
                generationMs: event.generationMs,
                firstTokenMs: event.firstTokenMs,
              }
            }
            if (!fault && ['accepted', 'queued', 'started', 'delta', 'model.status'].includes(event.type)) send(event)
          },
        })
        await fault?.waitForRelease()
        send({ type: 'completed', message, metrics })
      } catch (error: any) {
        send({ type: 'failed', error: error.error || { code: 'MODEL_UNAVAILABLE', message: String(error), retryable: true } })
      } finally {
        response.end()
      }
    })()
      .catch((error) => response.destroy(error))
      .finally(() => jobs.delete(cancel))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      service.once('error', reject)
      service.listen(0, '127.0.0.1', resolve)
    })
    const apiBase = `http://127.0.0.1:${(service.address() as import('node:net').AddressInfo).port}`
    const configPath = path.join(output, 'host-config.json')
    await fs.writeFile(
      configPath,
      JSON.stringify({ gameRoot, apiBase, panels: fixture.hostScenario === 'panels', settings: { version: 1, profiles: [profile], defaultProfileId: profile.id } }, null, 2)
    )
    const electron = createRequire(__filename)('electron') as string
    const child = spawn(electron, [path.join(__dirname, 'companion-engine-smoke.cjs'), gameRoot, output, troopArg, '', ...(fixtureArg ? [path.resolve(fixtureArg)] : [])], {
      env: { ...process.env, CHAYA_COMPANION_HOST_CONFIG: configPath },
      stdio: 'inherit',
    })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    const deadline = setTimeout(stop, (fixture.hostScenario === 'benchmark' ? 15 : 10) * 60_000)
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
      if (code !== 0) throw new Error(`Host smoke exited with ${code}`)
      const summary = JSON.parse(await fs.readFile(path.join(output, 'host-summary.json'), 'utf8')) as Array<{ name: string }>
      if (!summary.some((event) => event.name === 'host-acceptance-passed')) throw new Error('Host smoke exited without completing acceptance')
      if (fixture.hostScenario === 'experience') {
        const stored = JSON.parse(await fs.readFile(path.join(output, 'host-stored.json'), 'utf8')) as MemoryStoreSnapshot
        const projected = projectHpExperiences(
          (stored.battleRecording?.recentEvents ?? []).flatMap((event) =>
            event.kind === 'action_result' && event.result.evidence ? [{ ...event, evidence: event.result.evidence }] : []
          ),
          stored.memoryEpoch
        )
        const request = trace.findLast(
          (event: any) => event.type === 'request' && event.purpose === 'companion-chat' && event.messages.some((message: any) => message.content.includes('请引用 experiences'))
        ) as { requestId: string; messages: Array<{ role: string; content: string }> } | undefined
        assert(request, 'Actual model received the HP experience chat')
        const payload = JSON.parse(request.messages.find((message) => message.role === 'user')!.content)
        assert.equal(payload.experienceCoverage, 'retained_observations')
        assert(payload.experiences.length > 0, 'Actual model context contains HP experiences')
        const observed = ({ summary: _summary, applicability: _applicability, ...facts }: HpExperience) => facts
        for (const item of payload.experiences as HpExperience[]) {
          const actual = projected.find((candidate) => candidate.experienceId === item.experienceId)
          assert(actual, 'Context experience comes from durable engine evidence')
          assert.deepEqual(observed(item), observed(actual))
        }
        const completed = trace.find((event: any) => event.type === 'completed' && event.requestId === request.requestId) as { text: string } | undefined
        assert(completed, 'Real model completed the experience reference')
        const reply = JSON.parse(
          completed.text
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
        )
        assert(reply.blocks?.some((block: any) => block.kind === 'experience_ref' && block.experienceId === payload.experiences[0].experienceId))
        const chat = summary.find((event) => event.name === 'hp-experience-chat-passed') as { text?: string } | undefined
        assert.equal(chat?.text, payload.experiences[0].summary, 'Host displays the canonical summary, without model-authored numeric claims')
        await fs.writeFile(path.join(output, 'hp-experience-acceptance.json'), JSON.stringify({ requestId: request.requestId, payload, reply, projected }, null, 2) + '\n')
      }
      if (fixture.hostScenario === 'benchmark') {
        const benchmarkPath = path.join(output, 'benchmark-summary.json')
        const benchmark = JSON.parse(await fs.readFile(benchmarkPath, 'utf8'))
        for (const attempt of benchmark.attempts) {
          const requests = trace.filter(
            (event: any) => ['request', 'legacy-request'].includes(event.type) && event.at >= attempt.startedAt && event.at <= attempt.endedAt
          ) as Array<{ requestId: string; purpose?: string; at: number; type: string }>
          attempt.serviceModelRequests = requests.filter((request) => request.purpose !== 'companion-warmup').length
          attempt.warmupChecks = requests.filter((request) => request.purpose === 'companion-warmup').length
          attempt.serviceRequests = requests.map((request) => {
            const events = trace.filter((event: any) => event.requestId === request.requestId) as any[]
            const completed = events.find((event) => ['completed', 'legacy-completed'].includes(event.type))
            const failed = events.find((event) => ['failed', 'legacy-failed', 'cancelled'].includes(event.type))
            const ready = events.find((event) => event.type === 'model.status' && event.phase === 'ready')
            return {
              requestId: request.requestId,
              purpose: request.purpose ?? 'legacy-tool-turn',
              outcome: completed ? 'completed' : failed ? 'failed' : 'unknown',
              totalMs: completed?.durationMs ?? failed?.durationMs,
              contextMs: completed?.contextMs,
              queueMs: completed?.waitedMs,
              residency: ready?.residency,
              startupMs: ready?.startupMs,
              generationMs: completed?.generationMs,
              firstTokenMs: completed?.firstTokenMs,
              providerTiming: completed?.timing ?? completed?.message?.timing,
            }
          })
        }
        await fs.writeFile(benchmarkPath, JSON.stringify(benchmark, null, 2) + '\n')
      }
      if (
        fixture.hostScenario === 'stagnation' &&
        !trace.some(
          (event: any) =>
            event.type === 'request' &&
            event.purpose === 'companion-tactic-deep' &&
            event.messages?.some((message: any) => message.role === 'user' && JSON.parse(message.content).reason === 'repeated_emergency_guard')
        )
      )
        throw new Error('Stagnation paused without requesting a model review')
    } finally {
      clearTimeout(deadline)
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
  } finally {
    control.close()
    await panels.close()
    for (const job of jobs) job.abort()
    service.closeAllConnections()
    await new Promise<void>((resolve) => service.close(() => resolve()))
    await daemon.close()
    await fs.writeFile(path.join(output, 'host-model-trace.json'), JSON.stringify(trace, null, 2) + '\n')
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
