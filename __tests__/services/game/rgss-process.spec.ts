import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildSync } from 'esbuild'

it('keeps a detached game writing stdout and stderr after its launcher exits', async () => {
  if (process.platform === 'win32') return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-game-process-'))
  const worker = path.join(dir, 'game.cjs')
  const parent = path.join(dir, 'launcher.cjs')
  const log = path.join(dir, 'runtime.log')
  let pid: number | undefined
  try {
    fs.writeFileSync(
      worker,
      `#!${process.execPath}
setTimeout(() => {
  process.stdout.write('game stdout after launcher exit\\n')
  process.stderr.write('game stderr after launcher exit\\n')
  process.stdout.write('completed\\n')
}, 200)
`
    )
    fs.chmodSync(worker, 0o755)
    buildSync({
      stdin: {
        contents: `import { spawnRgssProcess } from ${JSON.stringify(path.join(process.cwd(), 'services/game/rgss-process.ts'))};
          console.log(spawnRgssProcess(process.argv[2], {}, process.argv[3]).pid);`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: parent,
    })
    pid = Number(execFileSync(process.execPath, [parent, worker, log], { encoding: 'utf8', timeout: 3_000 }).trim())
    const deadline = Date.now() + 3_000
    while (!fs.readFileSync(log, 'utf8').includes('completed') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fs.readFileSync(log, 'utf8')).toContain('game stdout after launcher exit')
    expect(fs.readFileSync(log, 'utf8')).toContain('game stderr after launcher exit')
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* The fixture normally exits itself. */
      }
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
