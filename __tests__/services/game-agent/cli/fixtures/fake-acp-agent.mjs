import readline from 'node:readline'

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const waiting = new Map()
let nextId = 1000

function ask(method, params) {
  const id = ++nextId
  send({ id, method, params })
  return new Promise((resolve) => waiting.set(id, resolve))
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line)
  if (!message.method) {
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
    return
  }
  const { id, method, params } = message
  if (method === 'initialize') return send({ id, result: { protocolVersion: 1, agentCapabilities: {} } })
  if (method === 'session/new')
    return send({
      id,
      result: {
        sessionId: 'sess-1',
        modes: { currentModeId: 'agent', availableModes: [{ id: 'agent' }, { id: 'ask' }] },
        models: {
          currentModelId: 'default[]',
          availableModels: [
            { modelId: 'default[]', name: 'Auto' },
            { modelId: 'fast[x=1]', name: 'fast' },
          ],
        },
      },
    })
  if (method === 'session/set_mode') return send({ id, result: {} })
  if (method === 'session/set_model') {
    if (params.modelId !== 'fast[x=1]') return send({ id, error: { code: -32602, message: 'Invalid params', data: { message: `Invalid model value: ${params.modelId}` } } })
    return send({ id, result: {} })
  }
  if (method === 'session/prompt') {
    const permission = await ask('session/request_permission', {
      sessionId: params.sessionId,
      toolCall: { toolCallId: 't1', title: 'Shell' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
      ],
    })
    const fsCall = await ask('fs/read_text_file', { sessionId: params.sessionId, path: '/etc/hosts' })
    const chunk = (text) =>
      send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } })
    chunk(`permission=${permission.result.outcome.optionId};`)
    chunk(`fs=${fsCall.error ? fsCall.error.code : 'allowed'};`)
    chunk(params.prompt[0].text.includes('hang') ? '' : 'OK')
    if (params.prompt[0].text.includes('hang')) return
    return send({ id, result: { stopReason: 'end_turn' } })
  }
  send({ id, error: { code: -32601, message: 'unknown' } })
})
