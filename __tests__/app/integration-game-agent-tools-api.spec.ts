import fs from 'node:fs'

import { GET, PUT } from '@/app/api/integration/game-agent/tools/route.server'
import { TOOL_SETTINGS_PATH } from '@/services/game-agent/tool-settings'

const ctx = { params: Promise.resolve({}) }
const url = 'http://localhost/api/integration/game-agent/tools'

function put(body: unknown) {
  return PUT(new Request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx)
}

async function stored() {
  return (await (await GET(new Request(url), ctx)).json()).settings
}

beforeEach(() => fs.rmSync(TOOL_SETTINGS_PATH, { force: true }))
afterEach(() => fs.rmSync(TOOL_SETTINGS_PATH, { force: true }))

test('two windows patching different fields keep both changes', async () => {
  await Promise.all([put({ patch: { miniMapEnabled: true } }), put({ patch: { smartPathEnabled: false } })])
  expect(await stored()).toMatchObject({ miniMapEnabled: true, smartPathEnabled: false })
})

test('rejects a body with neither settings nor patch', async () => {
  expect((await put({})).status).toBe(400)
})
