'use strict'

const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function accessDir() {
  if (process.env.CHAYA_DATA_DIR) return path.join(path.resolve(process.env.CHAYA_DATA_DIR), 'access')
  return path.resolve(__dirname, '../data/access')
}

function ensureAccessToken() {
  if (process.env.CHAYA_AUTH_TOKEN) return process.env.CHAYA_AUTH_TOKEN
  const dir = accessDir()
  const file = path.join(dir, 'token')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(file)) {
    // Electron and Next may start together: write temp then atomic publish to avoid an empty token.
    const pending = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    try {
      fs.writeFileSync(pending, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
      try {
        fs.linkSync(pending, file)
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
      }
    } finally {
      fs.rmSync(pending, { force: true })
    }
  }
  const token = fs.readFileSync(file, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid data/access/token; remove it and restart')
  return token
}

module.exports = { ensureAccessToken }
