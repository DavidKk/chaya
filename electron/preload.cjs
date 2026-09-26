'use strict'

/**
 * 预留桥接；首版不暴露 Node。contextIsolation + sandbox。
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('chayaDesktop', {
  runtime: 'electron',
  serviceMode: 'app',
})
