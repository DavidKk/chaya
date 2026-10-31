import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { listLiveAgentProcesses, resetLiveAgentProcessesForTests, trackLiveAgentProcess } from '@/services/game-agent/cli/live-processes.server'

jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process')
  const execFile = Object.assign(jest.fn(), { [jest.requireActual('node:util').promisify.custom]: jest.fn() })
  return { ...actual, execFile }
})

const read = (execFile as unknown as Record<symbol, jest.Mock>)[promisify.custom]

afterEach(() => {
  resetLiveAgentProcessesForTests()
  read.mockReset()
})

function track() {
  return trackLiveAgentProcess({ kind: 'stdio', pid: process.pid, file: '/bin/codex', args: ['app-server'], env: {} })
}

test('an empty owned list does not start ps', async () => {
  await expect(listLiveAgentProcesses()).resolves.toEqual([])
  expect(read).not.toHaveBeenCalled()
})

test('owned sampling selects only tracked pids and never scans host executables', async () => {
  track()
  read.mockResolvedValue({ stdout: `${process.pid} 1 0.5 2048 01:00 /bin/codex app-server\n` })
  const rows = await listLiveAgentProcesses()
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledWith('ps', ['-p', String(process.pid), '-o', expect.any(String)], expect.any(Object))
  expect(rows).toEqual([expect.objectContaining({ pid: process.pid, source: 'chaya', stats: { cpuPercent: 0.5, memoryBytes: 2048 * 1024, elapsed: '01:00' } })])
})

test('a failed stats read still shows living tracked processes', async () => {
  track()
  read.mockRejectedValue(new Error('ps unavailable'))
  const rows = await listLiveAgentProcesses()
  expect(rows).toEqual([expect.objectContaining({ pid: process.pid, source: 'chaya', stats: { cpuPercent: null, memoryBytes: null, elapsed: null } })])
})

test('host scan is opt-in, preserves paths with spaces, and excludes desktop helpers', async () => {
  track()
  const cursor = '/Users/me/Library/Application Support/Cursor/agent-cli/.local/bin/cursor-agent'
  const desktop = '/Applications/Codex.app/Contents/MacOS/Codex'
  read
    .mockResolvedValueOnce({ stdout: `${process.pid} 1 0 100 00:01 /bin/codex app-server\n700001 1 0 100 00:01 ${cursor} acp\n700002 1 0 100 00:01 ${desktop}\n` })
    .mockResolvedValueOnce({ stdout: `${process.pid} /bin/codex\n700001 ${cursor}\n700002 ${desktop}\n` })
  const rows = await listLiveAgentProcesses({ includeSystem: true })
  expect(read).toHaveBeenCalledTimes(2)
  expect(rows).toEqual([expect.objectContaining({ pid: process.pid, source: 'chaya' }), expect.objectContaining({ pid: 700001, source: 'system', file: cursor, args: ['acp'] })])
})
