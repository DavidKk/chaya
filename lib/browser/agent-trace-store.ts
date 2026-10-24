import type { AgentTraceArchive } from '@/lib/game-agent/trace'

let connectedArchive: AgentTraceArchive | null = null
export function setBrowserAgentTraceArchive(archive: AgentTraceArchive | null) {
  connectedArchive = archive
}

const memoryArchive: AgentTraceArchive = {
  append: async () => {},
  appendSource: async () => {},
  list: async () => [],
  read: async () => null,
  export: async () => null,
  remove: async () => 0,
}

function archive(): AgentTraceArchive {
  return connectedArchive ?? memoryArchive
}

/** The browser is a remote view; it never opens an asset database. */
export const browserAgentTraceArchive: AgentTraceArchive = {
  append: (task, event) => archive().append(task, event),
  appendSource: (event) => (archive().appendSource ? archive().appendSource!(event) : Promise.reject(new Error('Source events must be recorded by the game host'))),
  list: () => archive().list(),
  read: (taskId) => archive().read(taskId),
  export: (taskId) => archive().export(taskId),
  remove: (taskId) => archive().remove(taskId),
}
