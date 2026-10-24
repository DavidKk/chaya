import fs from 'node:fs'
import path from 'node:path'

import { PLAY_SYSTEM_PROMPT, playModelPrompt } from '@/lib/game-agent/play-prompt'
import { type AgentHost, capabilityConfig, runAgentTurn, type RuntimeMessage, type RuntimeTool } from '@/lib/game-agent/runtime'
import { DEFAULT_OLLAMA_HOST, streamOllamaChat } from '@/services/game-agent/ollama-client'
import type { GameAgentMessage, OllamaTool } from '@/services/game-agent/types'

const taskId = process.env.CHAYA_REPLAY_TASK || 'ab5020a5-be20-4139-8cd7-2f71490f515a'
const logFile = process.env.CHAYA_REPLAY_LOG || path.join(process.cwd(), 'logs', 'agent-activity', `${taskId}.events.jsonl`)
const mapFile = process.env.CHAYA_REPLAY_MAP || '/Users/davidjones/Downloads/Heroines.of.Swords.Spells.2/game/www/data/Map004.json'
const goal = '除人物、入口之外都帮我交互一下'
const useRealModel = process.env.CHAYA_CONTEXT_REAL === '1'
const endpoint = process.env.CHAYA_OLLAMA_HOST || DEFAULT_OLLAMA_HOST
const modelName = process.env.CHAYA_AGENT_MODEL || 'gemma4:e4b'

type JsonObject = Record<string, unknown>
type TraceRow = { type?: string; data?: JsonObject }

function readRows(file: string): TraceRow[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceRow)
}

function output(row: TraceRow): unknown {
  const data = row.data
  return data && typeof data.output === 'object' ? data.output : undefined
}

function fixtureFromTrace(rows: TraceRow[]) {
  const states = rows.filter((row) => row.type === 'tool.completed' && row.data?.name === 'chaya_live_state').map(output)
  const interactions = rows.filter((row) => row.type === 'tool.completed' && row.data?.name === 'chaya_live_interact').map(output)
  if (!states.length || !interactions.length) throw new Error(`Trace ${taskId} 缺少可重放的状态或交互结果`)
  const eventIds = interactions.map((item) => Number((item as JsonObject).eventId)).filter(Number.isInteger)
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { width?: number; height?: number; events?: unknown[] }
  const firstState = states[0] as JsonObject
  const stateMap = firstState.map as JsonObject | undefined
  return {
    states,
    interactions,
    eventIds,
    source: {
      taskId,
      gameId: '9fbaf1d7-236c-4e0a-9fe1-4c8be4129a64',
      mapId: stateMap?.id,
      mapName: stateMap?.name,
      mapWidth: map.width,
      mapHeight: map.height,
      mapEventCount: Array.isArray(map.events) ? map.events.filter(Boolean).length : 0,
      stateCount: states.length,
      interactionCount: interactions.length,
    },
  }
}

const tools: RuntimeTool[] = [
  { name: 'chaya_live_state', description: 'Read the current visible game state.', groups: ['live'], inputSchema: { type: 'object', properties: {} } },
  {
    name: 'chaya_live_interact',
    description: 'Walk to and interact with one visible event.',
    groups: ['live'],
    inputSchema: { type: 'object', properties: { eventId: { type: 'number' } }, required: ['eventId'] },
  },
]

function ollamaTools(): OllamaTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description || tool.name, parameters: tool.inputSchema || { type: 'object', properties: {} } },
  }))
}

function runFixture(fixture: ReturnType<typeof fixtureFromTrace>, baseline: boolean) {
  const events: JsonObject[] = []
  let stateIndex = 0
  let interactionIndex = 0
  let modelIndex = 0
  const proposedActions: Array<string | null> = []
  const model: AgentHost['model']['complete'] = async (messages, _runtimeTools, signal) => {
    const eventId = fixture.eventIds[modelIndex]
    modelIndex++
    const reply: RuntimeMessage =
      eventId === undefined
        ? { role: 'assistant', content: '你已经完成了这次场景中的目标交互。' }
        : { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_live_interact', arguments: { eventId } } }] }
    if (useRealModel) {
      const response = await streamOllamaChat(
        {
          endpoint,
          model: modelName,
          messages: messages as GameAgentMessage[],
          tools: ollamaTools(),
          think: false,
          timeoutMs: 120_000,
          signal,
        },
        () => undefined
      )
      proposedActions.push(response.tool_calls?.[0]?.function.name || null)
      return response as RuntimeMessage
    }
    proposedActions.push(reply.tool_calls?.[0]?.function.name || null)
    const input = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4)
    const outputTokens = Math.ceil(reply.content.length / 4)
    return { ...reply, usage: { input, output: outputTokens, total: input + outputTokens } }
  }
  const host: AgentHost = {
    model: { complete: model },
    tools: {
      list: () => tools,
      call: async (name) => {
        if (name === 'chaya_live_state') return fixture.states[stateIndex++]
        if (name === 'chaya_live_interact') return fixture.interactions[interactionIndex++]
        return { ok: false, error: `Unexpected tool ${name}` }
      },
    },
    store: { append: () => undefined },
    events: { emit: (event) => events.push(event as unknown as JsonObject) },
    clock: { now: () => Date.now() },
  }
  const startedAt = Date.now()
  return runAgentTurn(
    host,
    capabilityConfig('play'),
    {
      prompt: goal,
      model: modelName,
      modelPrompt: playModelPrompt(goal, 0, '', 'zh-CN'),
      history: [{ role: 'system', content: PLAY_SYSTEM_PROMPT }],
      replyLanguage: 'zh-CN',
      debug: {
        disableCompaction: baseline,
        disableSnapshotReplacement: baseline,
        preserveRequestedInteractions: true,
      },
    },
    new AbortController().signal
  ).then((result) => {
    const requests = events.filter((event) => event.type === 'model.requested')
    const completions = events.filter((event) => event.type === 'model.completed')
    const toolCompletions = events.filter((event) => event.type === 'tool.completed')
    const contextChars = requests.map((event) => Number(event.contextChars || 0))
    const tokens = completions.map((event) => event.usage).filter(Boolean) as Array<{ input?: number; output?: number; total?: number }>
    return {
      mode: baseline ? 'baseline_no_compaction' : 'optimized_compaction',
      elapsedMs: Date.now() - startedAt,
      result,
      modelRequests: requests.length,
      contextChars,
      contextCharsTotal: contextChars.reduce((sum, value) => sum + value, 0),
      estimatedInputTokens: Math.ceil(contextChars.reduce((sum, value) => sum + value, 0) / 4),
      tokenUsage: tokens.reduce((sum, usage) => sum + Number(usage.total || 0), 0),
      toolCalls: toolCompletions.length,
      interactionCalls: toolCompletions.filter((event) => event.name === 'chaya_live_interact').length,
      stateReads: toolCompletions.filter((event) => event.name === 'chaya_live_state').length,
      selectedEventIds: events
        .filter((event) => event.type === 'tool.started' && event.name === 'chaya_live_interact')
        .map((event) => Number((event.input as JsonObject | undefined)?.eventId)),
      proposedActions,
      replayExact:
        events
          .filter((event) => event.type === 'tool.started' && event.name === 'chaya_live_interact')
          .map((event) => Number((event.input as JsonObject | undefined)?.eventId))
          .every((eventId, index) => eventId === fixture.eventIds[index]) && interactionIndex === fixture.interactions.length,
    }
  })
}

async function main() {
  const fixture = fixtureFromTrace(readRows(logFile))
  if (useRealModel) {
    const optimized = await runFixture(fixture, false)
    // eslint-disable-next-line no-console -- developer replay output
    console.log(JSON.stringify({ fixture: fixture.source, mode: 'real-ollama-shadow-replay', endpoint, model: modelName, recordedEventIds: fixture.eventIds, optimized }, null, 2))
    return
  }
  const baseline = await runFixture(fixture, true)
  const optimized = await runFixture(fixture, false)
  // eslint-disable-next-line no-console -- developer replay output
  console.log(JSON.stringify({ fixture: fixture.source, mode: 'deterministic-comparison', recordedEventIds: fixture.eventIds, baseline, optimized }, null, 2))
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- developer replay error output
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
