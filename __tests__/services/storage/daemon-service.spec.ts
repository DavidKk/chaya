jest.mock('wordguard', () => ({
  wordguard: () => ({
    matchAll: () => [],
  }),
}))

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { readStorageDaemonMeta } from '@/services/storage/daemon-lock'
import { startStorageDaemon, type StorageDaemonServer } from '@/services/storage/daemon-service.server'

describe('daemon-service', () => {
  let tmpDir: string
  let daemon: StorageDaemonServer | null = null

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-daemon-svc-test-'))
  })

  afterEach(async () => {
    if (daemon) {
      await daemon.close()
      daemon = null
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  function makeRequest(port: number, pathname: string, method = 'GET', token?: string, body?: string): Promise<{ status: number; data: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (token) headers['x-chaya-auth-token'] = token

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: pathname,
          method,
          headers,
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => (raw += chunk))
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 0, data: JSON.parse(raw) })
            } catch {
              resolve({ status: res.statusCode || 0, data: { raw } })
            }
          })
        }
      )
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }

  it('repairs old composed dialogue and refreshes it after shared and local edits without another translation run', async () => {
    const root = path.join(tmpDir, 'game')
    fs.mkdirSync(path.join(root, 'data'), { recursive: true })
    fs.mkdirSync(path.join(root, 'js'))
    fs.writeFileSync(path.join(root, 'index.html'), '')
    fs.writeFileSync(path.join(root, 'data/System.json'), JSON.stringify({ gameTitle: 'Projection RPC Test', versionId: 1 }))
    const src = 'Yeah. I can do 22 pushups in a row now.'
    const tail = 'I can do 22 pushups in a row now.'
    fs.writeFileSync(path.join(root, 'chaya-trans.seed.json'), JSON.stringify({ [src]: '' }))
    daemon = await startStorageDaemon({ dataDir: path.join(tmpDir, 'public'), port: 0 })
    const call = async (method: string, args: unknown[]) => {
      const result = await makeRequest(daemon!.port, '/api/storage/rpc', 'POST', daemon!.authToken, JSON.stringify({ method, args }))
      expect(result.status).toBe(200)
      return result.data.value
    }
    const state = (await call('game.mount', [root])) as { directory: string }
    const file = path.join(state.directory, 'translate/cache.ndjson')
    const pair = { from: 'en', to: 'zh' }
    const current = () =>
      fs.existsSync(file)
        ? fs
            .readFileSync(file, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .find((row) => row.s === src)?.t
        : undefined
    const waitFor = async (expected: string | undefined) => {
      const deadline = Date.now() + 3000
      while (current() !== expected && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
      expect(current()).toBe(expected)
    }
    await call('shared.writeMany', [
      [
        ['Yeah.', '是的。'],
        [tail, '我现在可以连续做22个俯卧撑。'],
      ],
      'import',
      pair,
    ])
    await call('shared.syncGameCache', [root])
    await waitFor('是的。 我现在可以连续做22个俯卧撑。')
    await call('shared.update', [tail, '我能连续做二十二个俯卧撑了。', 'manual', pair])
    await waitFor('是的。 我能连续做二十二个俯卧撑了。')
    await call('game.append', [root, [{ s: 'Yeah.', t: '没错。', engine: 'manual' }]])
    await waitFor('没错。 我能连续做二十二个俯卧撑了。')
    await call('shared.remove', [tail, pair])
    await waitFor(undefined)
  })

  it('imports resource versions and deduplicates observations through the authenticated RPC endpoint', async () => {
    daemon = await startStorageDaemon({ dataDir: tmpDir, port: 0 })
    const call = async (method: string, args: unknown[]) => {
      const result = await makeRequest(daemon!.port, '/api/storage/rpc', 'POST', daemon!.authToken, JSON.stringify({ method, args }))
      expect(result.status).toBe(200)
      return result.data.value
    }
    const content = [
      { type: 'manifest', schemaVersion: 1, packId: 'test.fr', version: '1', languages: [{ tag: 'fr', name: 'French' }] },
      {
        type: 'entry',
        entryId: 'aie',
        sourceLanguage: 'fr',
        targetLanguage: 'zh',
        scope: { kind: 'global' },
        reviewStatus: 'reviewed',
        provenance: { kind: 'manual-example' },
        sourceText: 'Aïe',
        targetText: '哎哟',
        match: { kind: 'exact' },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n')
    const preview = (await call('resources.preview', [content])) as { token: string }
    await call('resources.apply', [content, preview.token])
    expect(await call('resources.list', [])).toEqual(expect.arrayContaining([expect.objectContaining({ packId: 'test.fr', active: 1 })]))
    expect(await call('resources.export', ['test.fr', '1'])).toContain('哎哟')
    const nextContent = content
      .split('\n')
      .map((line) => {
        const record = JSON.parse(line)
        return JSON.stringify(record.type === 'manifest' ? { ...record, version: '2' } : record)
      })
      .join('\n')
    const nextPreview = (await call('resources.preview', [nextContent])) as { token: string }
    await call('resources.install', [nextContent, nextPreview.token])
    expect(await call('resources.list', [])).toEqual(
      expect.arrayContaining([expect.objectContaining({ packId: 'test.fr', version: '1', active: 1 }), expect.objectContaining({ packId: 'test.fr', version: '2', active: 0 })])
    )
    await call('resources.activate', ['test.fr', '2'])
    expect(await call('resources.list', [])).toEqual(
      expect.arrayContaining([expect.objectContaining({ packId: 'test.fr', version: '1', active: 0 }), expect.objectContaining({ packId: 'test.fr', version: '2', active: 1 })])
    )
    await call('resources.disable', ['test.fr'])
    expect(await call('resources.list', [])).toEqual(expect.arrayContaining([expect.objectContaining({ packId: 'test.fr', active: 0 })]))
    await call('resources.activate', ['test.fr', '1'])
    const event = { eventId: 'rpc-test-event', occurredAt: 1, sourceText: 'Aïe', targetText: null, sourceLanguage: 'fr', targetLanguage: 'zh', error: 'No engine' }
    expect(await call('observations.append', [[event]])).toEqual({ inserted: 1 })
    expect(await call('observations.append', [[event]])).toEqual({ inserted: 0 })
    expect(await call('observations.export', [{ sourceLanguage: 'fr' }])).toEqual({ nextCursor: 1, items: [event] })
  })

  it('uses the production RPC path, preserves legacy sources and recovers stale public views on retry', async () => {
    const root = path.join(tmpDir, 'game')
    fs.mkdirSync(path.join(root, 'data'), { recursive: true })
    fs.mkdirSync(path.join(root, 'js'))
    fs.writeFileSync(path.join(root, 'index.html'), '')
    fs.writeFileSync(path.join(root, 'data/System.json'), JSON.stringify({ gameTitle: 'Storage RPC Test', versionId: 1 }))
    const legacy = path.join(root, 'chaya-trans.seed.json')
    fs.writeFileSync(legacy, JSON.stringify({ hello: '原有译文' }))
    const dataDir = path.join(tmpDir, 'public')
    daemon = await startStorageDaemon({ dataDir, port: 0 })
    const call = (method: string, args: unknown[]) => makeRequest(daemon!.port, '/api/storage/rpc', 'POST', daemon!.authToken, JSON.stringify({ method, args }))
    const mount = await call('game.mount', [root])
    expect(mount.status).toBe(200)
    const state = mount.data.value as { directory: string; gameId: string }
    const seed = path.join(state.directory, 'translate/seed.json')
    const seedStat = () => {
      const { ino, mtimeNs, ctimeNs } = fs.statSync(seed, { bigint: true })
      return { ino, mtimeNs, ctimeNs }
    }
    const originalSeedStat = seedStat()
    expect(state.directory.startsWith(fs.realpathSync(dataDir))).toBe(true)
    expect(fs.readFileSync(legacy, 'utf8')).toBe(JSON.stringify({ hello: '原有译文' }))
    const append = [root, [{ s: 'hello', t: '人工修改', engine: 'manual' }], 'retry-key']
    expect((await call('game.append', append)).status).toBe(200)
    expect(seedStat()).toEqual(originalSeedStat)
    const cache = path.join(state.directory, 'translate/cache.ndjson')
    expect(fs.readFileSync(cache, 'utf8')).toContain('人工修改')
    expect(seedStat()).toEqual(originalSeedStat)
    fs.writeFileSync(path.join(state.directory, '.revision'), '-1')
    fs.writeFileSync(cache, '')
    expect((await call('game.append', append)).data.value).toMatchObject({ duplicated: true })
    expect(fs.readFileSync(cache, 'utf8')).toContain('人工修改')
    expect(seedStat()).toEqual(originalSeedStat)
    expect((await call('game.append', [root, [{ s: 'hello', t: '不同内容' }], 'retry-key'])).status).toBe(500)
    await call('game.append', [root, [{ s: 'hello', t: null }], 'delete-key'])
    expect(fs.readFileSync(cache, 'utf8')).toContain('"t":null')
    await call('game.write', [root, 'gameEdit', { enabled: true }])
    expect(seedStat()).toEqual(originalSeedStat)
    await daemon.close()
    daemon = await startStorageDaemon({ dataDir, port: 0 })
    expect((await call('game.mount', [root])).data.value).toMatchObject({ gameId: state.gameId })
    expect(seedStat()).toEqual(originalSeedStat)
    expect((await call('game.read', [root, 'gameEdit'])).data.value).toEqual({ enabled: true })
    await call('game.write', [root, 'seed', { hello: '原有译文', goodbye: null }])
    expect(seedStat().ino).not.toBe(originalSeedStat.ino)
    expect(JSON.parse(fs.readFileSync(seed, 'utf8'))).toEqual({ hello: '原有译文', goodbye: null })
    fs.unlinkSync(seed)
    await call('game.mount', [root])
    expect(JSON.parse(fs.readFileSync(seed, 'utf8'))).toEqual({ hello: '原有译文', goodbye: null })
    expect(fs.existsSync(path.join(root, 'chaya/translate/cache.ndjson'))).toBe(false)
  })

  it('starts daemon on loopback, responds to ping and protects endpoints with authToken', async () => {
    daemon = await startStorageDaemon({
      dataDir: tmpDir,
      port: 0, // pick ephemeral port
      authToken: 'secret-token-xyz',
    })

    expect(daemon.port).toBeGreaterThan(0)
    expect(daemon.authToken).toBe('secret-token-xyz')

    // Ping uses the same authentication as every other endpoint.
    expect((await makeRequest(daemon.port, '/api/storage/ping')).status).toBe(401)
    const pingRes = await makeRequest(daemon.port, '/api/storage/ping', 'GET', daemon.authToken)
    expect(pingRes.status).toBe(200)
    expect(pingRes.data.ok).toBe(true)

    // 2. Unauthenticated protected endpoint returns 401
    const unauthRes = await makeRequest(daemon.port, '/api/storage/translations/snapshot?gameId=test')
    expect(unauthRes.status).toBe(401)

    // 3. Authenticated protected endpoint succeeds
    const authRes = await makeRequest(daemon.port, '/api/storage/translations/snapshot?gameId=test', 'GET', daemon.authToken)
    expect(authRes.status).toBe(200)
    expect(authRes.data.gameId).toBe('test')
    expect(Array.isArray(authRes.data.gameTranslations)).toBe(true)

    // 4. Batch commit and lookup over HTTP
    const commitRes = await makeRequest(
      daemon.port,
      '/api/storage/translations/commit',
      'POST',
      daemon.authToken,
      JSON.stringify({
        gameId: 'http-game-1',
        actor: 'test-agent',
        entries: [{ src: 'アイテム', zh: '道具' }],
      })
    )
    expect(commitRes.status).toBe(200)
    expect(commitRes.data.appliedCount).toBe(1)

    const lookupRes = await makeRequest(daemon.port, '/api/storage/translations/lookup?gameId=http-game-1&src=%E3%82%A2%E3%82%A4%E3%83%86%E3%83%A0', 'GET', daemon.authToken)
    expect(lookupRes.status).toBe(200)
    expect(lookupRes.data.zh).toBe('道具')
    expect(lookupRes.data.scope).toBe('game')
  })

  it('publishes a fallback port without releasing ownership', async () => {
    const occupied = http.createServer()
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve))
    try {
      const address = occupied.address()
      if (!address || typeof address === 'string') throw new Error('Missing address')
      daemon = await startStorageDaemon({ dataDir: tmpDir, port: address.port })
      expect(daemon.port).not.toBe(address.port)
      expect(readStorageDaemonMeta(tmpDir)?.port).toBe(daemon.port)
      await expect(startStorageDaemon({ dataDir: tmpDir, port: 0 })).rejects.toThrow('already running')
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
  })

  it('idle shutdown closes databases and releases the guard, and close is repeatable', async () => {
    daemon = await startStorageDaemon({ dataDir: tmpDir, port: 0, idleTimeoutMs: 20 })
    const deadline = Date.now() + 2000
    while (readStorageDaemonMeta(tmpDir) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(readStorageDaemonMeta(tmpDir)).toBeNull()
    await daemon.close()
    await daemon.close()
    daemon = await startStorageDaemon({ dataDir: tmpDir, port: 0 })
    expect(daemon.port).toBeGreaterThan(0)
  })

  it('rejects invalid input and oversized bodies without breaking subsequent requests', async () => {
    daemon = await startStorageDaemon({ dataDir: tmpDir, port: 0 })
    const send = (body: string) => makeRequest(daemon!.port, '/api/storage/translations/commit', 'POST', daemon!.authToken, body)
    expect((await send('{')).status).toBe(400)
    expect((await send(JSON.stringify({ gameId: 'test', actor: 'test', entries: [{ src: 'src', isDeleted: 'false' }] }))).status).toBe(400)
    expect((await send('x'.repeat(1024 * 1024 + 1))).status).toBe(413)
    expect((await makeRequest(daemon.port, '/api/storage/ping', 'GET', daemon.authToken)).status).toBe(200)
  })
})
