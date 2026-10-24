#!/usr/bin/env node
'use strict'

const { ensureListenPort } = require('./ensure-listen-port.cjs')

const port = process.argv[2] || process.env.PORT || '3000'

ensureListenPort(port).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
