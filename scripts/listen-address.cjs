'use strict'

const os = require('node:os')

function detectLanIpv4(interfaces = os.networkInterfaces()) {
  const candidates = []
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const entry of addresses || []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) candidates.push({ name, address: entry.address })
    }
  }
  const score = (candidate) => {
    let priority = 0
    if (/^(en\d+|eth\d+|wlan.*|wi-?fi.*)$/i.test(candidate.name)) priority += 100
    if (/^192\.168\./.test(candidate.address)) priority += 50
    else if (/^10\./.test(candidate.address)) priority += 40
    else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(candidate.address)) priority += 30
    if (/^(bridge|feth|veth|docker|vmnet|vbox|utun)/i.test(candidate.name)) priority -= 80
    return priority
  }
  candidates.sort((left, right) => score(right) - score(left))
  return candidates[0]?.address || null
}

function serviceUrl(host, port, lanIp = detectLanIpv4()) {
  const address = ['0.0.0.0', '::', '[::]'].includes(host) ? lanIp || '127.0.0.1' : host
  const hostname = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address
  return `http://${hostname}:${port}`
}

module.exports = { detectLanIpv4, serviceUrl }
