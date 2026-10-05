'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
/** `node scripts/demo-game.cjs [translate|walk]`: fixture → demos/<dir>/www with the freshly built plugins */
const DEMOS = {
  translate: { fixture: 'fixtures/game-demo/www', dir: 'demos/simple-game/www', files: ['index.html', 'game.js', 'package.json'] },
  walk: { fixture: 'fixtures/game-walk/www', dir: 'demos/walk-game/www', files: ['index.html', 'data.js', 'objects.js', 'game.js', 'package.json'] },
}
const demo = DEMOS[process.argv[2] || 'translate']
if (!demo) throw new Error(`unknown demo: ${process.argv[2]} (use ${Object.keys(DEMOS).join(' / ')})`)
const source = path.join(root, demo.fixture)
const target = path.join(root, demo.dir)
const plugins = path.join(target, 'js/plugins')
const names = ['ChayaLoader', 'ChayaLog', 'ChayaTrans', 'ChayaBoost', 'ChayaEdit', 'ChayaAgent']

fs.mkdirSync(plugins, { recursive: true })
for (const file of demo.files) {
  fs.copyFileSync(path.join(source, file), path.join(target, file))
}
const pluginsJs = path.join(target, 'js/plugins.js')
if (!fs.existsSync(pluginsJs)) {
  const registry = [{ name: 'ChayaLoader', status: true, description: 'Chaya plugin loader', parameters: {} }]
  fs.writeFileSync(pluginsJs, `var $plugins =\n${JSON.stringify(registry, null, 2)};\n`)
}
fs.mkdirSync(path.join(target, 'data'), { recursive: true })
writeRmMaps()
const settingsFile = path.join(target, 'chaya/config/translation-play.json')
if (!fs.existsSync(settingsFile)) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify({ mode: 'realtime', model: '', timeoutMs: 8000 }) + '\n')
}
for (const name of names) {
  const from = path.join(root, 'plugins/dist', `${name}.js`)
  if (!fs.existsSync(from)) throw new Error(`missing plugin build: ${from}`)
  fs.copyFileSync(from, path.join(plugins, `${name}.js`))
}
/** Demos exposing `WalkDemo.rmMap` get `data/MapXXX.json` (+ `Tilesets.json`), which Chaya reads for maps the player is not on */
function writeRmMaps() {
  const dataJs = path.join(target, 'data.js')
  if (!fs.existsSync(dataJs)) return
  const sandbox = { window: {} }
  vm.runInNewContext(fs.readFileSync(dataJs, 'utf8'), sandbox)
  const demoData = sandbox.window.WalkDemo
  if (!demoData?.rmMap) return
  for (const id of Object.keys(demoData.MAPS)) {
    fs.writeFileSync(path.join(target, 'data', `Map${String(id).padStart(3, '0')}.json`), JSON.stringify(demoData.rmMap(Number(id))))
  }
  if (demoData.rmTileset) fs.writeFileSync(path.join(target, 'data', 'Tilesets.json'), JSON.stringify([null, demoData.rmTileset]))
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
