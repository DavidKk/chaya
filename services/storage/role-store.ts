import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { AiRole } from '@/lib/game-agent/roles'

const safe = (id: string) => {
  const value = id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160)
  return !value || value === '.' || value === '..' ? '_' : value
}

export class RoleRevisionConflictError extends Error {
  constructor(roleId: string, expected: number, actual: number) {
    super(`角色版本冲突：${roleId} 预期版本为 ${expected}，当前实际版本为 ${actual}`)
    this.name = 'RoleRevisionConflictError'
  }
}

export type RoleCurrentManifest = {
  roleId: string
  revision: number
  updatedAt: number
  role: AiRole
  filesManifest: Record<string, string>
}

export type RoleStore = {
  list(): Promise<AiRole[]>
  read(roleId: string, revision?: number): Promise<{ role: AiRole; revision: number; files: Record<string, string> } | null>
  commit(role: AiRole, options?: { expectedRevision?: number; mutationId?: string; files?: Record<string, string> }): Promise<{ ok: boolean; roleId: string; revision: number }>
  remove(roleId: string): Promise<boolean>
  import(roles: AiRole[]): Promise<{ imported: number; skipped: number }>
  directory: string
}

export function createRoleStore(dataDir: string): RoleStore {
  const rolesDir = path.join(dataDir, 'game-agent', 'roles')
  fs.mkdirSync(rolesDir, { recursive: true })

  const roleDir = (roleId: string) => path.join(rolesDir, safe(roleId))
  const currentFile = (roleId: string) => path.join(roleDir(roleId), 'current.json')
  const revisionsDir = (roleId: string) => path.join(roleDir(roleId), 'revisions')

  function atomicWrite(targetPath: string, content: string): void {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
    fs.writeFileSync(tmpPath, content, 'utf8')
    fs.renameSync(tmpPath, targetPath)
  }

  async function readManifest(roleId: string): Promise<RoleCurrentManifest | null> {
    const file = currentFile(roleId)
    if (!fs.existsSync(file)) return null
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as RoleCurrentManifest
    } catch {
      return null
    }
  }

  async function list(): Promise<AiRole[]> {
    if (!fs.existsSync(rolesDir)) return []
    const entries = fs.readdirSync(rolesDir, { withFileTypes: true })
    const results: AiRole[] = []
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const manifest = await readManifest(ent.name)
      if (manifest?.role) {
        results.push({
          ...manifest.role,
          updatedAt: manifest.updatedAt || manifest.role.updatedAt,
          workspaceFiles: manifest.role.workspaceFiles,
        })
      }
    }
    return results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  async function read(roleId: string, revision?: number): Promise<{ role: AiRole; revision: number; files: Record<string, string> } | null> {
    const manifest = await readManifest(roleId)
    if (!manifest) return null

    const targetRevision = revision ?? manifest.revision
    const revDir = path.join(revisionsDir(roleId), String(targetRevision))
    const roleFile = path.join(revDir, 'role.json')

    let role = manifest.role
    if (fs.existsSync(roleFile)) {
      try {
        role = JSON.parse(fs.readFileSync(roleFile, 'utf8')) as AiRole
      } catch {}
    }

    const files: Record<string, string> = {}
    if (fs.existsSync(revDir)) {
      const readTree = (currentSubDir: string, prefix = '') => {
        const items = fs.readdirSync(currentSubDir, { withFileTypes: true })
        for (const it of items) {
          const rel = prefix ? `${prefix}/${it.name}` : it.name
          if (it.name === 'role.json') continue
          if (it.isDirectory()) {
            readTree(path.join(currentSubDir, it.name), rel)
          } else if (it.isFile()) {
            files[rel] = fs.readFileSync(path.join(currentSubDir, it.name), 'utf8')
          }
        }
      }
      readTree(revDir)
    }

    return { role, revision: targetRevision, files }
  }

  async function commit(
    role: AiRole,
    options?: { expectedRevision?: number; mutationId?: string; files?: Record<string, string> }
  ): Promise<{ ok: boolean; roleId: string; revision: number }> {
    const roleId = safe(role.id)
    if (!roleId) throw new Error('Role ID is required')

    const current = await readManifest(roleId)
    const currentRevision = current?.revision ?? 0

    if (options?.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
      throw new RoleRevisionConflictError(roleId, options.expectedRevision, currentRevision)
    }

    const nextRevision = currentRevision + 1
    const now = Date.now()
    const targetRevDir = path.join(revisionsDir(roleId), String(nextRevision))
    fs.mkdirSync(targetRevDir, { recursive: true })

    const filesManifest: Record<string, string> = {}
    const filesToCommit = options?.files || role.workspaceFiles || {}
    const resolvedRevDir = path.resolve(targetRevDir)

    for (const [relPath, content] of Object.entries(filesToCommit)) {
      const cleanRel = relPath.replace(/^[/\\]+/, '')
      const normalized = path.normalize(cleanRel).replace(/^(\.\.(\/|\\|$))+/, '')
      const targetFilePath = path.resolve(targetRevDir, normalized)
      if (!targetFilePath.startsWith(resolvedRevDir + path.sep) && targetFilePath !== resolvedRevDir) {
        throw new Error(`Invalid workspace file path: ${relPath}`)
      }
      fs.mkdirSync(path.dirname(targetFilePath), { recursive: true })
      fs.writeFileSync(targetFilePath, content, 'utf8')
      filesManifest[normalized] = createHash('sha256').update(content).digest('hex')
    }

    const updatedRole: AiRole = {
      ...role,
      updatedAt: now,
      workspaceFiles: filesToCommit,
    }

    atomicWrite(path.join(targetRevDir, 'role.json'), JSON.stringify(updatedRole, null, 2))

    const manifest: RoleCurrentManifest = {
      roleId,
      revision: nextRevision,
      updatedAt: now,
      role: updatedRole,
      filesManifest,
    }

    atomicWrite(currentFile(roleId), JSON.stringify(manifest, null, 2))
    return { ok: true, roleId, revision: nextRevision }
  }

  async function remove(roleId: string): Promise<boolean> {
    const target = roleDir(roleId)
    if (!fs.existsSync(target)) return false
    fs.rmSync(target, { recursive: true, force: true })
    return true
  }

  async function importRoles(roles: AiRole[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0
    let skipped = 0
    for (const r of roles) {
      const existing = await readManifest(r.id)
      if (!existing) {
        await commit(r, { files: r.workspaceFiles })
        imported++
      } else {
        skipped++
      }
    }
    return { imported, skipped }
  }

  return {
    directory: rolesDir,
    list,
    read,
    commit,
    remove,
    import: importRoles,
  }
}
