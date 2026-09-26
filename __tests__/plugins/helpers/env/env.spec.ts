/**
 * @jest-environment jsdom
 */
import { DEFAULT_CHAYA_API_BASE, pinApiBaseFromUrl, resolveApiBase, resolveApiBaseFallbacks, resolveLogUrl } from '@/plugins/src/helpers/env/env'

describe('helpers/env', () => {
  const prevEnv = process.env.CHAYA_LOG_URL

  afterEach(() => {
    delete (window as Window & { CHAYA_API_BASE?: string; CHAYA_LOG_URL?: string }).CHAYA_API_BASE
    delete (window as Window & { CHAYA_LOG_URL?: string }).CHAYA_LOG_URL
    if (prevEnv === undefined) delete process.env.CHAYA_LOG_URL
    else process.env.CHAYA_LOG_URL = prevEnv
  })

  it('resolveApiBase: strips trailing slash; uses default when unset', () => {
    expect(resolveApiBase()).toBe(DEFAULT_CHAYA_API_BASE.replace(/\/$/, ''))
    ;(window as Window & { CHAYA_API_BASE?: string }).CHAYA_API_BASE = 'http://192.168.1.2:3927/'
    expect(resolveApiBase()).toBe('http://192.168.1.2:3927')
  })

  it('resolveApiBaseFallbacks: dedupes; injected base first then loopback', () => {
    ;(window as Window & { CHAYA_API_BASE?: string }).CHAYA_API_BASE = DEFAULT_CHAYA_API_BASE
    expect(resolveApiBaseFallbacks()).toEqual([DEFAULT_CHAYA_API_BASE.replace(/\/$/, '')])

    ;(window as Window & { CHAYA_API_BASE?: string }).CHAYA_API_BASE = 'http://10.0.0.2:3927/'
    expect(resolveApiBaseFallbacks()).toEqual(['http://10.0.0.2:3927', DEFAULT_CHAYA_API_BASE.replace(/\/$/, '')])
  })

  it('resolveLogUrl: window > env > default', () => {
    ;(window as Window & { CHAYA_LOG_URL?: string }).CHAYA_LOG_URL = 'http://x/log'
    expect(resolveLogUrl()).toBe('http://x/log')
    delete (window as Window & { CHAYA_LOG_URL?: string }).CHAYA_LOG_URL
    process.env.CHAYA_LOG_URL = 'http://env/log'
    expect(resolveLogUrl()).toBe('http://env/log')
  })

  it('pinApiBaseFromUrl: 钉到资源 URL 的 origin', () => {
    pinApiBaseFromUrl('https://app.example.com/api/plugins/ChayaEdit.js')
    expect(resolveApiBase()).toBe('https://app.example.com')
    expect(resolveLogUrl()).toBe('https://app.example.com/api/logs')

    pinApiBaseFromUrl('http://192.168.3.24:3927/api/plugins/ChayaLoader.js')
    expect(resolveApiBase()).toBe('http://192.168.3.24:3927')
  })
})
