import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AiRole } from '@/lib/game-agent/roles'
import { createRoleStore, RoleRevisionConflictError } from '@/services/storage/role-store'

describe('Role Store Persistence (F04)', () => {
  let tmpDir: string
  let store: ReturnType<typeof createRoleStore>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-role-store-test-'))
    store = createRoleStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const sampleRole: AiRole = {
    id: 'nagi',
    name: 'Nagi',
    gender: 'female',
    avatar: 'nagi',
    description: 'Calm companion',
    provider: 'ollama' as any,
    model: 'qwen3:4b',
    lines: [{ id: '1', scene: 'idle', text: 'Hello' }],
    idleLineGeneration: true,
  }

  it('commits role and workspace markdown files to disk with versioned revisions', async () => {
    const files = {
      'AGENTS.md': '# Agent Guidelines',
      'IDENTITY.md': '# Nagi Identity',
      'memory/adventures.md': '# Adventure Log',
    }

    const commitRes = await store.commit(sampleRole, { files })
    expect(commitRes.ok).toBe(true)
    expect(commitRes.roleId).toBe('nagi')
    expect(commitRes.revision).toBe(1)

    // Verify files on disk
    const currentFile = path.join(tmpDir, 'game-agent', 'roles', 'nagi', 'current.json')
    expect(fs.existsSync(currentFile)).toBe(true)

    const revDir = path.join(tmpDir, 'game-agent', 'roles', 'nagi', 'revisions', '1')
    expect(fs.existsSync(path.join(revDir, 'role.json'))).toBe(true)
    expect(fs.readFileSync(path.join(revDir, 'AGENTS.md'), 'utf8')).toBe('# Agent Guidelines')
    expect(fs.readFileSync(path.join(revDir, 'memory', 'adventures.md'), 'utf8')).toBe('# Adventure Log')

    // Read back
    const readRes = await store.read('nagi')
    expect(readRes).not.toBeNull()
    expect(readRes!.role.name).toBe('Nagi')
    expect(readRes!.revision).toBe(1)
    expect(readRes!.files['AGENTS.md']).toBe('# Agent Guidelines')
    expect(readRes!.files['memory/adventures.md']).toBe('# Adventure Log')
  })

  it('rejects concurrent edits with mismatched expectedRevision', async () => {
    await store.commit(sampleRole, { files: { 'AGENTS.md': 'V1' } })

    // Attempt to commit with wrong expectedRevision
    await expect(store.commit(sampleRole, { expectedRevision: 0, files: { 'AGENTS.md': 'V2' } })).rejects.toThrow(RoleRevisionConflictError)

    // Correct expectedRevision succeeds and increments revision
    const res2 = await store.commit(sampleRole, { expectedRevision: 1, files: { 'AGENTS.md': 'V2' } })
    expect(res2.revision).toBe(2)

    const readRes = await store.read('nagi')
    expect(readRes!.revision).toBe(2)
    expect(readRes!.files['AGENTS.md']).toBe('V2')
  })

  it('lists committed roles across directories', async () => {
    await store.commit(sampleRole)
    const role2: AiRole = { ...sampleRole, id: 'rin', name: 'Rin' }
    await store.commit(role2)

    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list.map((r) => r.id).sort()).toEqual(['nagi', 'rin'])
  })

  it('imports roles idempotently from localStorage payloads', async () => {
    const rolesToImport = [sampleRole, { ...sampleRole, id: 'koto', name: 'Koto' }]

    const res = await store.import(rolesToImport)
    expect(res.imported).toBe(2)
    expect(res.skipped).toBe(0)

    // Re-importing skips already present roles
    const res2 = await store.import(rolesToImport)
    expect(res2.imported).toBe(0)
    expect(res2.skipped).toBe(2)
  })

  it('removes role workspace on deletion', async () => {
    await store.commit(sampleRole)
    expect(await store.read('nagi')).not.toBeNull()

    const removed = await store.remove('nagi')
    expect(removed).toBe(true)
    expect(await store.read('nagi')).toBeNull()
  })
})
