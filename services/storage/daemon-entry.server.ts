import { DATA_DIR } from '@/constants/paths'

import { startStorageDaemon } from './daemon-service.server'

process.env.CHAYA_STORAGE_OWNER = '1'
void startStorageDaemon({ dataDir: DATA_DIR, port: 0 })
  .then((daemon) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void daemon.close().then(() => process.exit(0))
      })
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error)
    process.exitCode = 1
  })
