import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

it('shares one complete management token when two first-time starters overlap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-access-'))
  const source = fs.readFileSync(path.resolve('scripts/local-access.cjs'), 'utf8')
  const exports = { ensureAccessToken: (): string => '' }
  const moduleRef = { exports }
  let competingToken = ''
  let overlap = true
  const competingFs = {
    ...fs,
    writeFileSync: ((file, contents, options) => {
      // Force the second process between O_CREAT and the first process's write.
      fs.writeFileSync(file, '', options)
      if (overlap) {
        overlap = false
        competingToken = moduleRef.exports.ensureAccessToken()
      }
      fs.writeFileSync(file, contents)
    }) as typeof fs.writeFileSync,
  }
  try {
    vm.runInNewContext(source, {
      module: moduleRef,
      __dirname: path.join(dir, 'scripts'),
      process: { env: {}, pid: process.pid },
      require: (name: string) => (name === 'node:fs' ? competingFs : jest.requireActual(name)),
    })
    const token = moduleRef.exports.ensureAccessToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(competingToken).toBe(token)
    expect(moduleRef.exports.ensureAccessToken()).toBe(token)
    expect(fs.readdirSync(path.join(dir, 'data/access'))).toEqual(['token'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
