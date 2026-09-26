'use strict'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const contentRoot = path.resolve(process.argv[2] || process.env.CHAYA_DEMO_GAME || '')
if (!process.argv[2] && !process.env.CHAYA_DEMO_GAME) throw new Error('缺少 Demo 内容目录')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: 'Chaya 翻译测试游戏',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  })
  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') console.error(`[game] ${message}`)
  })
  void win.loadFile(path.join(contentRoot, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
