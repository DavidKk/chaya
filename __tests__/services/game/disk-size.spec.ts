import { execFile } from 'node:child_process'
import fs from 'node:fs'

import { measureDirSizeBytes } from '@/services/game/disk-size'

jest.mock('node:child_process', () => ({ execFile: jest.fn() }))

it('returns immediately and shares a pending asynchronous scan across polls', () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(true)
  expect(measureDirSizeBytes('/audit-large-game')).toBeNull()
  expect(measureDirSizeBytes('/audit-large-game')).toBeNull()
  expect(execFile).toHaveBeenCalledTimes(1)
  const callback = jest.mocked(execFile).mock.calls[0][3] as unknown as (error: Error | null, out: string) => void
  callback(null, '2048\t/audit-large-game')
  expect(measureDirSizeBytes('/audit-large-game')).toBe(2097152)
  expect(execFile).toHaveBeenCalledTimes(1)
})
