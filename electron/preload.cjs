'use strict'

/**
 * Reserved preload bridge; v1 exposes no Node APIs. contextIsolation + sandbox.
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('chayaDesktop', {
  runtime: 'electron',
  serviceMode: 'app',
})
