/**
 * @jest-environment jsdom
 */
import { setupHitTestManager } from '@/plugins/rgss/src/hit-test-manager'
import { initHostBridge, onGameMessage, postToGame } from '@/plugins/rgss/src/host-bridge'
import { RgssWebRtcGateway } from '@/plugins/rgss/src/webrtc-gateway'

describe('RGSS Host Bridge', () => {
  beforeEach(() => {
    delete (window as any).__chaya_on_game_message
    delete (window as any).__chaya_mock_game_receiver
    delete (window as any).webkit
    delete (window as any).chrome
  })

  it('initializes global __chaya_on_game_message and dispatches parsed messages', () => {
    initHostBridge()
    expect(typeof (window as any).__chaya_on_game_message).toBe('function')

    const received: any[] = []
    const unsub = onGameMessage((msg) => received.push(msg))

    // Direct object
    ;(window as any).__chaya_on_game_message({ type: 'edit.state', ready: true })
    // JSON string
    ;(window as any).__chaya_on_game_message(JSON.stringify({ type: 'edit.ack', ok: true }))

    expect(received).toHaveLength(2)
    expect(received[0]).toEqual({ type: 'edit.state', ready: true })
    expect(received[1]).toEqual({ type: 'edit.ack', ok: true })

    unsub()
    ;(window as any).__chaya_on_game_message({ type: 'ignored' })
    expect(received).toHaveLength(2)
  })

  it('posts message to macOS WKWebView messageHandler', () => {
    const postMessageMock = jest.fn()
    ;(window as any).webkit = {
      messageHandlers: {
        chaya: {
          postMessage: postMessageMock,
        },
      },
    }

    postToGame({ type: 'edit.cmd', op: 'gold', value: 999 })
    expect(postMessageMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(postMessageMock.mock.calls[0][0])).toEqual({
      type: 'edit.cmd',
      op: 'gold',
      value: 999,
    })
  })

  it('uploads native log batches to the plugin log service', async () => {
    const previousFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true }) })
    global.fetch = fetchMock
    const dispose = initHostBridge()
    const entries = [{ id: 1, ts: 123, source: 'ChayaRGSS', level: 'debug', message: '[Translation][name_control] Luno -> 卢诺' }]
    try {
      ;(window as any).__chaya_on_game_message({ type: 'log.batch', entries })
      await Promise.resolve()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe(`${window.location.origin}/api/logs`)
      expect(JSON.parse(options.body).entries).toEqual(entries)
    } finally {
      dispose()
      global.fetch = previousFetch
    }
  })

  it('posts message to Windows WebView2', () => {
    const postMessageMock = jest.fn()
    ;(window as any).chrome = {
      webview: {
        postMessage: postMessageMock,
      },
    }

    postToGame({ type: 'edit.cmd', op: 'var', id: 1, value: 50 })
    expect(postMessageMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(postMessageMock.mock.calls[0][0])).toEqual({
      type: 'edit.cmd',
      op: 'var',
      id: 1,
      value: 50,
    })
  })

  it('rejects a missing native host instead of dropping commands', () => {
    expect(() => postToGame({ type: 'ping', t: 1 })).toThrow('native host is unavailable')
  })
})

describe('RGSS Hit Test Manager', () => {
  it('publishes regions before hover and stops publishing after disposal', () => {
    jest.useFakeTimers()
    const send = jest.fn()
    ;(window as any).webkit = { messageHandlers: { chaya: { postMessage: send } } }
    const dispose = setupHitTestManager()
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: 'host.regions', rects: [] })
    dispose()
    expect(jest.getTimerCount()).toBe(0)
    delete (window as any).webkit
    jest.useRealTimers()
  })
})

describe('RGSS WebRTC Gateway', () => {
  it('instantiates and stops cleanly', () => {
    const gateway = new RgssWebRtcGateway('test-room', 'http://127.0.0.1:3000')
    expect(gateway.roomId).toBe('test-room')
    gateway.start()
    gateway.stop()
  })
})

describe('RGSS End-to-End Relay Pipeline', () => {
  it('relays WebRTC messages into native postToGame and routes Ruby replies back to WebRTC DataChannel', () => {
    const postedToNative: string[] = []
    ;(window as any).webkit = {
      messageHandlers: {
        chaya: {
          postMessage: (json: string) => postedToNative.push(json),
        },
      },
    }

    initHostBridge()

    const sentOverRtc: string[] = []
    const mockChannel = {
      readyState: 'open',
      send: (data: string) => sentOverRtc.push(data),
      close: jest.fn(),
    }

    const gateway = new RgssWebRtcGateway('test-room', 'http://127.0.0.1:3000', {
      onMessage: (msg) => postToGame(msg),
    })

    // Simulate WebRTC gateway connected and channel established
    ;(gateway as any).dc = mockChannel

    // 1. External WebRTC client sends command -> Should route to native host
    const clientCmd = { type: 'edit.cmd', op: 'gold', value: 9999, cmdId: 'c1' }
    ;(gateway as any).handlers.onMessage?.(clientCmd)

    expect(postedToNative).toHaveLength(1)
    expect(JSON.parse(postedToNative[0])).toEqual(clientCmd)

    // 2. Ruby sends reply via __chaya_on_game_message -> Should be forwarded to WebRTC DataChannel
    const unsub = onGameMessage((msg) => gateway.send(msg))
    const rubyReply = { type: 'edit.ack', cmdId: 'c1', ok: true, fields: ['gold'] }
    ;(window as any).__chaya_on_game_message(rubyReply)

    expect(sentOverRtc).toHaveLength(1)
    expect(JSON.parse(sentOverRtc[0])).toEqual(rubyReply)

    unsub()
    gateway.stop()
  })
})
