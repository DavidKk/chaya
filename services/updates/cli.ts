import fs from 'node:fs'

import { startUpdateInstall, updateCoordinator } from './coordinator'

async function main() {
  const [command, id, version] = process.argv.slice(2)
  if (command === 'check') return updateCoordinator.check()
  if (command === 'list') return updateCoordinator.list()
  if (command === 'import' && id) {
    if (fs.statSync(id).size > 2_500_000) throw new Error('Offline update exceeds size limit')
    return updateCoordinator.importOffline(fs.readFileSync(id, 'utf8'))
  }
  if (!id || !version) throw new Error('Usage: pnpm updates check | list | install ID VERSION | activate ID VERSION | rollback ID VERSION | import FILE')
  if (command === 'install') {
    const result = await startUpdateInstall(id, version).done
    if (result.status !== 'done') throw new Error(result.error || 'Installation canceled')
    return result.result
  }
  if (command === 'activate' || command === 'rollback') return updateCoordinator.activate(id, version, command === 'rollback')
  throw new Error('Unknown update command')
}
main()
  .then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  })
  .catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
