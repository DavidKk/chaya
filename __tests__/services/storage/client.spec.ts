import fs from 'node:fs'

import { ensureStorageDaemon } from '@/services/storage/client'

jest.mock('@/services/storage/daemon-lock', () => ({
  readStorageDaemonMeta: () => ({ port: 3927, authToken: 'test' }),
}))

it.each(['test', 'production'])('does not publish a public storage locator from a Jest worker with NODE_ENV=%s', (nodeEnv) => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousWorkerId = process.env.JEST_WORKER_ID
  Object.assign(process.env, { NODE_ENV: nodeEnv, JEST_WORKER_ID: '1' })
  const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
    throw new Error('A test must not replace the public storage locator')
  })
  const rename = jest.spyOn(fs, 'renameSync')
  try {
    expect(ensureStorageDaemon().port).toBe(3927)
    expect(write).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
  } finally {
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
    else Object.assign(process.env, { NODE_ENV: previousNodeEnv })
    if (previousWorkerId === undefined) delete process.env.JEST_WORKER_ID
    else process.env.JEST_WORKER_ID = previousWorkerId
  }
})
