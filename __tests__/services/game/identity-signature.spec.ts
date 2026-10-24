import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { verifyIdentity } from '@/lib/game/identity-signature'
import type { ResolvedGame } from '@/lib/game/types'
import { computeGameSignature } from '@/services/game/identity-signature'

describe('identity-signature', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-id-sig-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('computes deterministic MV/MZ signature and handles MATCH and DRIFT', () => {
    const dataDir = path.join(tmpDir, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'System.json'), JSON.stringify({ gameTitle: 'Hero Quest', versionId: 101, startMapId: 1 }))
    fs.writeFileSync(path.join(dataDir, 'Actors.json'), JSON.stringify([null, { id: 1, name: 'Harold', profile: 'Hero' }]))
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'hero-quest', title: 'Hero Quest' }))

    const resolved: ResolvedGame = {
      ok: true,
      selected: tmpDir,
      contentRoot: tmpDir,
      projectRoot: tmpDir,
      kind: 'content-root',
      engine: 'MZ',
      shellApp: '',
      hasShell: false,
      hasWwwLayout: false,
      bundled: false,
    }

    const sig1 = computeGameSignature(resolved)
    expect(sig1.title).toBe('Hero Quest')
    expect(sig1.signature).toMatch(/^[0-9a-f]{64}$/)

    // Same files give identical signature
    const sig2 = computeGameSignature(resolved)
    expect(sig2.signature).toBe(sig1.signature)

    // MATCH test
    const matchRes = verifyIdentity(
      {
        gameId: 'game-123',
        engine: 'MZ',
        title: 'Hero Quest',
        signatureBaseline: sig1.signature,
        signatureVersion: 1,
        boundPath: tmpDir,
        firstBoundAt: Date.now() - 1000,
        lastVerifiedAt: Date.now() - 1000,
      },
      sig2
    )
    expect(matchRes.status).toBe('MATCH')

    // Patch/Update test (DRIFT)
    fs.writeFileSync(path.join(dataDir, 'Actors.json'), JSON.stringify([null, { id: 1, name: 'Harold', profile: 'Hero v2' }]))
    const sigDrift = computeGameSignature(resolved)
    expect(sigDrift.signature).not.toBe(sig1.signature)

    const driftRes = verifyIdentity(
      {
        gameId: 'game-123',
        engine: 'MZ',
        title: 'Hero Quest',
        signatureBaseline: sig1.signature,
        signatureVersion: 1,
        boundPath: tmpDir,
        firstBoundAt: Date.now() - 1000,
        lastVerifiedAt: Date.now() - 1000,
      },
      sigDrift
    )
    expect(driftRes.status).toBe('DRIFT')

    // Conflict test (MISMATCH)
    const mismatchRes = verifyIdentity(
      {
        gameId: 'game-999',
        engine: 'MZ',
        title: 'Another Game',
        signatureBaseline: '0000000000000000000000000000000000000000000000000000000000000000',
        signatureVersion: 1,
        boundPath: '/other/path',
        firstBoundAt: Date.now() - 1000,
        lastVerifiedAt: Date.now() - 1000,
      },
      sigDrift
    )
    expect(mismatchRes.status).toBe('MISMATCH')
  })

  it('computes RGSS signature from Game.ini and rvdata binaries', () => {
    const dataDir = path.join(tmpDir, 'Data')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'Game.ini'), '[Game]\r\nTitle=Dragon Tale\r\nScripts=Data\\Scripts.rvdata2\r\n')
    fs.writeFileSync(path.join(dataDir, 'System.rvdata2'), Buffer.from('binary-system-header-bytes-data'))
    fs.writeFileSync(path.join(dataDir, 'Actors.rvdata2'), Buffer.from('binary-actors-header-bytes-data'))

    const resolved: ResolvedGame = {
      ok: true,
      selected: tmpDir,
      contentRoot: tmpDir,
      projectRoot: tmpDir,
      kind: 'rgss',
      engine: 'VX Ace',
      shellApp: '',
      hasShell: false,
      hasWwwLayout: false,
      bundled: false,
    }

    const sig = computeGameSignature(resolved)
    expect(sig.title).toBe('Dragon Tale')
    expect(sig.signature).toMatch(/^[0-9a-f]{64}$/)
  })
  it('blocks generic default titles from triggering false DRIFT', () => {
    const baseline = {
      gameId: 'game-default',
      engine: 'MZ' as const,
      title: 'Game',
      signatureBaseline: '1111111111111111111111111111111111111111111111111111111111111111',
      signatureVersion: 1,
      boundPath: '/path/1',
      firstBoundAt: Date.now() - 1000,
      lastVerifiedAt: Date.now() - 1000,
    }

    const current = {
      engine: 'MZ' as const,
      title: 'Game',
      signature: '2222222222222222222222222222222222222222222222222222222222222222',
      signatureVersion: 1,
      contentRoot: '/path/2',
      sampledAt: Date.now(),
    }

    const res = verifyIdentity(baseline, current)
    expect(res.status).toBe('MISMATCH')
    expect(res.details).toContain('generic default name')
  })

  it('computes RGSS signature from encrypted archive when loose Data is absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'Game.ini'), '[Game]\r\nTitle=Commercial RPG\r\nScripts=Data\\Scripts.rvdata2\r\n')
    fs.writeFileSync(path.join(tmpDir, 'Game.rgss3a'), Buffer.from('encrypted-rgss3a-archive-payload-bytes'))

    const resolved: ResolvedGame = {
      ok: true,
      selected: tmpDir,
      contentRoot: tmpDir,
      projectRoot: tmpDir,
      kind: 'rgss',
      engine: 'VX Ace',
      shellApp: '',
      hasShell: false,
      hasWwwLayout: false,
      bundled: false,
    }

    const sig = computeGameSignature(resolved)
    expect(sig.title).toBe('Commercial RPG')
    expect(sig.signature).toMatch(/^[0-9a-f]{64}$/)
  })
})
