import { afterEach, describe, expect, it } from '@jest/globals'

import { preferredPluginApiBase } from '@/services/runtime/presence'

describe('preferredPluginApiBase', () => {
  const prev = { ...process.env }

  afterEach(() => {
    process.env = { ...prev }
  })

  it('CHAYA_API_BASE 显式覆盖', () => {
    process.env.CHAYA_API_BASE = 'http://10.0.0.2:3927/'
    expect(preferredPluginApiBase(3927)).toBe('http://10.0.0.2:3927')
  })

  it('CHAYA_API_LAN=0 强制 loopback', () => {
    delete process.env.CHAYA_API_BASE
    process.env.CHAYA_API_LAN = '0'
    expect(preferredPluginApiBase(3927)).toBe('http://127.0.0.1:3927')
  })
})
