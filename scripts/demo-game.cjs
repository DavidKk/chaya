'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'fixtures/game-demo/www')
const target = path.join(root, 'demos/simple-game/www')
const plugins = path.join(target, 'js/plugins')
const names = ['ChayaLoader', 'ChayaLog', 'ChayaTrans', 'ChayaBoost', 'ChayaEdit']

fs.mkdirSync(plugins, { recursive: true })
for (const file of ['index.html', 'game.js', 'package.json']) {
  fs.copyFileSync(path.join(source, file), path.join(target, file))
}
const pluginsJs = path.join(target, 'js/plugins.js')
if (!fs.existsSync(pluginsJs)) {
  const registry = [{ name: 'ChayaLoader', status: true, description: 'Chaya plugin loader', parameters: {} }]
  fs.writeFileSync(pluginsJs, `var $plugins =\n${JSON.stringify(registry, null, 2)};\n`)
}
fs.mkdirSync(path.join(target, 'data'), { recursive: true })
const settingsFile = path.join(target, 'chaya/config/translation-play.json')
if (!fs.existsSync(settingsFile)) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify({ mode: 'realtime', model: '', timeoutMs: 8000 }) + '\n')
}
for (const name of names) {
  const from = path.join(root, 'plugins/dist', `${name}.js`)
  if (!fs.existsSync(from)) throw new Error(`缺少插件产物：${from}`)
  fs.copyFileSync(from, path.join(plugins, `${name}.js`))
}
const electron = require('electron')
const child = spawn(electron, [path.join(root, 'electron/demo-game.cjs'), target], {
  cwd: target,
  stdio: 'inherit',
  env: { ...process.env, CHAYA_DEMO_GAME: target },
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code || 0
})
