import os from 'node:os'

import listenAddress from '../../scripts/listen-address.cjs'

function ipv4(address: string, internal = false): os.NetworkInterfaceInfo {
  return { address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` }
}

describe('published service addresses', () => {
  it('prefers the physical LAN interface over virtual adapters and loopback', () => {
    const interfaces = {
      lo0: [ipv4('127.0.0.1', true)],
      feth0: [ipv4('192.168.191.24')],
      bridge100: [ipv4('192.168.64.1')],
      utun0: [ipv4('172.28.170.6')],
      en0: [ipv4('192.168.3.149')],
    }
    expect(listenAddress.detectLanIpv4(interfaces)).toBe('192.168.3.149')
    expect(listenAddress.detectLanIpv4({ eth0: [ipv4('10.0.0.8')] })).toBe('10.0.0.8')
  })

  it('publishes a usable LAN URL instead of the wildcard listen address', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({ en0: [ipv4('192.168.3.149')] })
    expect(listenAddress.serviceUrl('0.0.0.0', 3927)).toBe('http://192.168.3.149:3927')
    expect(listenAddress.serviceUrl('::', 3000)).toBe('http://192.168.3.149:3000')
    expect(listenAddress.serviceUrl('[::]', 3927)).toBe('http://192.168.3.149:3927')
  })

  it('preserves explicit hosts and brackets IPv6 URLs', () => {
    expect(listenAddress.serviceUrl('127.0.0.1', 3000, '192.168.3.149')).toBe('http://127.0.0.1:3000')
    expect(listenAddress.serviceUrl('192.168.3.10', 3000, '192.168.3.149')).toBe('http://192.168.3.10:3000')
    expect(listenAddress.serviceUrl('fd00::1', 3000, null)).toBe('http://[fd00::1]:3000')
  })

  it('falls back to a working local URL when the machine has no network', () => {
    expect(listenAddress.detectLanIpv4({ lo0: [ipv4('127.0.0.1', true)] })).toBeNull()
    expect(listenAddress.serviceUrl('0.0.0.0', 3927, null)).toBe('http://127.0.0.1:3927')
  })
})
