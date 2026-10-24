import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseAgentSyncDocument } from '@/lib/game-agent/settings-sync'
import { mcpPortConfigDir, processMcpPortEnv } from '@/lib/integration/mcp-port'
import { mergeOwnedGameAgentSyncDocument } from '@/services/game-agent/settings'

/** Import the former plugin authority once; retain the source for recovery. */
export function importLegacyAgentSettings(dataDir: string) {
  if (process.env.NODE_ENV === 'test') return
  const marker = path.join(dataDir, 'game-agent/legacy-plugin-import.json')
  if (fs.existsSync(marker)) return
  const source = path.join(mcpPortConfigDir(processMcpPortEnv(os.homedir())), 'game-agent.json')
  if (!fs.existsSync(source)) return
  const incoming = parseAgentSyncDocument(JSON.parse(fs.readFileSync(source, 'utf8')))
  if (!incoming) throw new Error('Legacy plugin Agent settings are invalid; source retained')
  mergeOwnedGameAgentSyncDocument(incoming, path.join(dataDir, 'game-agent/settings.sync.json'), path.join(dataDir, 'game-agent/settings.json'))
  fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 })
  const temporary = `${marker}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ source, importedAt: Date.now() }), { mode: 0o600 })
  fs.renameSync(temporary, marker)
}
