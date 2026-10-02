import { runLinkAgentRequest } from '@/plugins/src/helpers/game/agent-link'

describe('runLinkAgentRequest', () => {
  it('rejects methods outside the DataChannel whitelist', async () => {
    const run = jest.fn()
    expect(await runLinkAgentRequest({ method: 'game.eval', params: { code: '1' } }, { run })).toMatchObject({ status: 403 })
    expect(await runLinkAgentRequest({}, { run })).toMatchObject({ status: 403 })
    expect(run).not.toHaveBeenCalled()
  })

  it('requires the agent plugin', async () => {
    expect(await runLinkAgentRequest({ method: 'game.state' }, undefined)).toMatchObject({ status: 400 })
  })

  it('runs whitelisted commands and wraps results', async () => {
    const run = jest.fn(async () => ({ map: 1 }))
    expect(await runLinkAgentRequest({ method: 'plugin.tool', params: { plugin: 'ChayaEdit', tool: 'gold', input: { value: 1 } } }, { run })).toEqual({
      status: 200,
      data: { ok: true, result: { map: 1 } },
    })
    expect(run).toHaveBeenCalledWith({ id: 'link', method: 'plugin.tool', params: { plugin: 'ChayaEdit', tool: 'gold', input: { value: 1 } } })
    await runLinkAgentRequest({ method: 'game.state', params: ['x'] }, { run })
    expect(run).toHaveBeenLastCalledWith({ id: 'link', method: 'game.state', params: {} })
  })

  it('maps agent errors to 400', async () => {
    const run = jest.fn(async () => Promise.reject(new Error('插件未加载')))
    expect(await runLinkAgentRequest({ method: 'plugins.list' }, { run })).toEqual({ status: 400, data: { ok: false, error: { message: '插件未加载' } } })
  })
})
