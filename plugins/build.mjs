/** Independent plugin modules; either child can also be built on its own. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const watch = process.argv.includes('--watch')
const children = ['mv', 'rgss'].map((name) =>
  spawn(process.execPath, [fileURLToPath(new URL(`./${name}/build.mjs`, import.meta.url)), ...(watch ? ['--watch'] : [])], { stdio: 'inherit' })
)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => children.forEach((child) => child.kill(signal)))
const codes = await Promise.all(
  children.map(
    (child) =>
      new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => resolve(code ?? 1))
      })
  )
)
if (codes.some((code) => code !== 0)) process.exitCode = 1
