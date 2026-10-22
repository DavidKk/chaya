import { type AgentSyncDocument, mergeAgentSyncDocuments, parseAgentSyncDocument } from '@/lib/game-agent/settings-sync'
import { mcpPortConfigDir, processMcpPortEnv } from '@/lib/integration/mcp-port'

import { tryNodeRequire } from '../helpers/node/node-require'

const FILE_NAME = 'game-agent.json'

type SharedFile = { fs: typeof import('fs'); path: typeof import('path'); file: string }

function sharedFile(): SharedFile | null {
  const req = tryNodeRequire()
  if (!req) return null
  try {
    const fs = req('fs') as typeof import('fs')
    const path = req('path') as typeof import('path')
    const os = req('os') as typeof import('os')
    return { fs, path, file: path.join(mcpPortConfigDir(processMcpPortEnv(os.homedir())), FILE_NAME) }
  } catch {
    return null
  }
}

export function sharedAgentSettingsFile(): string | null {
  return sharedFile()?.file ?? null
}

/** Per-user copy next to `mcp.json`: every game reads it, so profiles set up in one game work in the others even offline. */
export function readSharedAgentSync(): AgentSyncDocument | null {
  const target = sharedFile()
  if (!target) return null
  try {
    return parseAgentSyncDocument(JSON.parse(target.fs.readFileSync(target.file, 'utf8')))
  } catch {
    return null
  }
}

/** Merges with what other games wrote meanwhile, then replaces the file atomically. Returns the merged document. */
export function writeSharedAgentSync(document: AgentSyncDocument): AgentSyncDocument {
  const target = sharedFile()
  if (!target) return document
  const onDisk = readSharedAgentSync()
  const merged = onDisk ? mergeAgentSyncDocuments(document, onDisk) : document
  try {
    target.fs.mkdirSync(target.path.dirname(target.file), { recursive: true, mode: 0o700 })
    const tmp = `${target.file}.${process.pid}.${Date.now()}.tmp`
    // Profiles can carry proxy credentials.
    target.fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
    target.fs.renameSync(tmp, target.file)
  } catch {
    /* The per-game copy in localStorage still holds the change. */
  }
  return merged
}
