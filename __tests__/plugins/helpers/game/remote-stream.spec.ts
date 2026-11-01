/**
 * @jest-environment jsdom
 */
import {
  applySilentWindowHiding,
  attachGameMediaStream,
  captureGameMediaStream,
  closeGameMediaPeer,
  ensureGameRenderKeepalive,
  handleHostAudioToggle,
  handleRemoteInput,
  handleRemoteTap,
  isolateHostAudio,
} from '@/plugins/mv/src/helpers/game/remote-stream'

describe('remote-stream (WebRTC game streaming & input simulation)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('captureGameMediaStream returns null when no canvas exists', () => {
    expect(captureGameMediaStream()).toBeNull()
  })

  it('handleRemoteInput updates Input._currentState and dispatches KeyboardEvent', () => {
    const inputState: Record<string, boolean> = {}
    ;(globalThis as unknown as { Input: { _currentState: Record<string, boolean> } }).Input = {
      _currentState: inputState,
    }

    const keydownSpy = jest.fn()
    const keyupSpy = jest.fn()
    document.addEventListener('keydown', keydownSpy)
    document.addEventListener('keyup', keyupSpy)

    handleRemoteInput('ok', 'down')
    expect(inputState.ok).toBe(true)
    expect(keydownSpy).toHaveBeenCalled()

    handleRemoteInput('ok', 'up')
    expect(inputState.ok).toBe(false)
    expect(keyupSpy).toHaveBeenCalled()

    document.removeEventListener('keydown', keydownSpy)
    document.removeEventListener('keyup', keyupSpy)
  })

  it('handleRemoteInput maps cancel/menu to escape and triggers TouchInput cancellation', () => {
    const inputObj: any = {
      _currentState: {},
      _latestButton: null,
      _pressedTime: 12,
    }
    const touchObj: any = {
      _cancelled: false,
      _events: { cancelled: false },
      _onCancel: jest.fn(),
      _x: 400,
      _y: 300,
    }
    ;(globalThis as any).Input = inputObj
    ;(globalThis as any).TouchInput = touchObj

    const dispatchedKeys: { key: string; keyCode: number }[] = []
    const keydownListener = (e: Event) => {
      const kev = e as KeyboardEvent
      dispatchedKeys.push({ key: kev.key, keyCode: kev.keyCode })
    }
    document.addEventListener('keydown', keydownListener)

    handleRemoteInput('cancel', 'down')

    expect(inputObj._currentState.escape).toBe(true)
    expect(inputObj._currentState.cancel).toBe(true)
    expect(inputObj._currentState.menu).toBe(true)
    expect(inputObj._latestButton).toBe('escape')
    expect(inputObj._pressedTime).toBe(0)

    expect(touchObj._cancelled).toBe(true)
    expect(touchObj._events.cancelled).toBe(true)
    expect(touchObj._onCancel).toHaveBeenCalledWith(400, 300)

    expect(dispatchedKeys).toContainEqual({ key: 'Escape', keyCode: 27 })
    expect(dispatchedKeys).toContainEqual({ key: 'x', keyCode: 88 })

    handleRemoteInput('cancel', 'up')
    expect(inputObj._currentState.escape).toBe(false)
    expect(inputObj._currentState.cancel).toBe(false)
    expect(inputObj._currentState.menu).toBe(false)
    expect(inputObj._latestButton).toBeNull()

    document.removeEventListener('keydown', keydownListener)
    delete (globalThis as any).Input
    delete (globalThis as any).TouchInput
  })

  it('handleRemoteTap triggers mouse events on canvas based on normalized coordinates', () => {
    const canvas = document.createElement('canvas')
    canvas.id = 'GameCanvas'
    document.body.appendChild(canvas)

    // Mock getBoundingClientRect
    canvas.getBoundingClientRect = jest.fn(() => ({
      left: 100,
      top: 50,
      width: 800,
      height: 600,
      right: 900,
      bottom: 650,
      x: 100,
      y: 50,
      toJSON: () => {},
    }))

    const mouseSpy = jest.fn()
    canvas.addEventListener('mousedown', mouseSpy)
    canvas.addEventListener('mouseup', mouseSpy)

    // Tap at center (0.5, 0.5)
    handleRemoteTap(0.5, 0.5, 'down')
    expect(mouseSpy).toHaveBeenCalled()
    const downEvent = mouseSpy.mock.calls[0][0] as MouseEvent
    expect(downEvent.clientX).toBe(100 + 400)
    expect(downEvent.clientY).toBe(50 + 300)

    handleRemoteTap(0.5, 0.5, 'up')
    expect(mouseSpy).toHaveBeenCalledTimes(2)
  })

  it('attachGameMediaStream attaches captured tracks to transceivers', async () => {
    const canvas = document.createElement('canvas')
    canvas.id = 'GameCanvas'
    document.body.appendChild(canvas)

    const mockVideoTrack = { kind: 'video', stop: jest.fn() } as unknown as MediaStreamTrack
    const mockStream = {
      active: true,
      getVideoTracks: () => [mockVideoTrack],
      getAudioTracks: () => [],
      addTrack: jest.fn(),
    } as unknown as MediaStream

    // Mock captureStream
    ;(canvas as unknown as { captureStream: () => MediaStream }).captureStream = jest.fn(() => mockStream)

    const replaceTrackMock = jest.fn().mockResolvedValue(undefined)
    const mockTransceiver = {
      receiver: { track: { kind: 'video' } },
      sender: { replaceTrack: replaceTrackMock },
      direction: 'recvonly',
    }

    const mockPeer = {
      close: jest.fn(),
      getTransceivers: jest.fn(() => [mockTransceiver]),
      addTrack: jest.fn(),
    } as unknown as RTCPeerConnection

    await attachGameMediaStream(mockPeer)
    expect(mockTransceiver.direction).toBe('sendonly')
    expect(replaceTrackMock).toHaveBeenCalledWith(mockVideoTrack)
    closeGameMediaPeer(mockPeer)
  })

  it('isolateHostAudio disconnects physical destination (Mac mute) and pipes into MediaStreamDestination', () => {
    const mockDestNode = { stream: { getAudioTracks: () => [{ kind: 'audio' }] } }
    const mockCtx = {
      destination: { id: 'physical-speaker' },
      createMediaStreamDestination: jest.fn(() => mockDestNode),
    }
    const mockGain = {
      disconnect: jest.fn(),
      connect: jest.fn(),
    }
    ;(globalThis as any).WebAudio = {
      _context: mockCtx,
      _masterGainNode: mockGain,
    }

    // Default: mute host machine (disconnects physical speakers)
    isolateHostAudio(false)
    expect(mockGain.disconnect).toHaveBeenCalledWith(mockCtx.destination)
    expect(mockCtx.createMediaStreamDestination).toHaveBeenCalled()
    expect(mockGain.connect).toHaveBeenCalledWith(mockDestNode)
    expect(mockGain.connect).not.toHaveBeenCalledWith(mockCtx.destination)

    // Unmute host toggle
    handleHostAudioToggle(true)
    expect(mockGain.connect).toHaveBeenCalledWith(mockCtx.destination)
  })

  it('applySilentWindowHiding hides NW.js desktop window when CHAYA_SILENT_MODE is active', () => {
    const hideSpy = jest.fn()
    const taskbarSpy = jest.fn()
    ;(globalThis as any).nw = {
      Window: {
        get: () => ({
          hide: hideSpy,
          setShowInTaskbar: taskbarSpy,
        }),
      },
    }
    ;(globalThis as any).CHAYA_SILENT_MODE = true

    applySilentWindowHiding()
    expect(hideSpy).toHaveBeenCalled()
    expect(taskbarSpy).toHaveBeenCalledWith(false)

    delete (globalThis as any).CHAYA_SILENT_MODE
  })

  it('shares capture across consumers, replaces recreated audio, and releases the final video track', async () => {
    const audio1 = { kind: 'audio', readyState: 'live' }
    const audio2 = { kind: 'audio', readyState: 'live' }
    const video = { kind: 'video', readyState: 'live', stop: jest.fn() }
    let audioTracks: any[] = []
    const stream = {
      active: true,
      getVideoTracks: () => [video],
      getAudioTracks: () => audioTracks,
      addTrack: (track: unknown) => {
        audioTracks.push(track)
      },
      removeTrack: (track: unknown) => {
        audioTracks = audioTracks.filter((item) => item !== track)
      },
    }
    const canvas = document.createElement('canvas')
    canvas.id = 'GameCanvas'
    const capture = jest.fn(() => stream)
    ;(canvas as any).captureStream = capture
    document.body.append(canvas)
    const audioContext = (track: unknown) => ({
      destination: {},
      createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [track] } }),
    })
    const host = globalThis as any
    host.WebAudio = { _context: audioContext(audio1), _masterGainNode: { connect: jest.fn(), disconnect: jest.fn() } }
    const sender = { track: audio1, replaceTrack: jest.fn(async () => {}) }
    const first = { close: jest.fn(), addTrack: jest.fn(), getSenders: () => [sender] } as unknown as RTCPeerConnection
    const second = { close: jest.fn(), addTrack: jest.fn() } as unknown as RTCPeerConnection
    await attachGameMediaStream(first)
    await attachGameMediaStream(second)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(audioTracks).toEqual([audio1])
    host.WebAudio._context = audioContext(audio2)
    isolateHostAudio()
    expect(sender.replaceTrack).toHaveBeenCalledWith(audio2)
    expect(audioTracks).toEqual([audio2])
    closeGameMediaPeer(first)
    expect(video.stop).not.toHaveBeenCalled()
    closeGameMediaPeer(second)
    expect(video.stop).toHaveBeenCalledTimes(1)
    delete host.WebAudio
  })
})

describe('remote render keepalive', () => {
  const host = globalThis as any
  let frames: FrameRequestCallback[]
  let scene: any
  let renderScene: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    delete host.WebAudio
    delete host.nw
    frames = []
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    renderScene = jest.fn()
    scene = {
      _stopped: false,
      renderScene,
      requestUpdate() {
        if (!this._stopped) requestAnimationFrame(this.update.bind(this))
      },
      update() {
        this.renderScene()
        this.requestUpdate()
      },
    }
    host.SceneManager = scene
    scene.requestUpdate()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
    delete host.SceneManager
    delete host.Graphics
  })

  it('renders close to 60 fps while RAF is suspended without accumulating callbacks', () => {
    ensureGameRenderKeepalive()
    ensureGameRenderKeepalive()
    jest.advanceTimersByTime(1000)

    expect(renderScene.mock.calls.length).toBeGreaterThanOrEqual(55)
    expect(renderScene.mock.calls.length).toBeLessThanOrEqual(63)
    expect(frames).toHaveLength(1)

    jest.advanceTimersByTime(9000)
    expect(frames).toHaveLength(1)
  })

  it('returns to a single native loop when the window becomes visible', () => {
    ensureGameRenderKeepalive()
    jest.advanceTimersByTime(5000)
    renderScene.mockClear()

    for (let i = 0; i < 60; i++) {
      const pending = frames.splice(0)
      for (const frame of pending) frame(performance.now())
      jest.advanceTimersByTime(16)
    }

    expect(renderScene).toHaveBeenCalledTimes(60)
    expect(frames).toHaveLength(1)
  })

  it('does not interleave timer frames with a phase-offset native RAF or alter engine frame skipping', () => {
    host.Graphics = { _maxSkip: 3 }
    ensureGameRenderKeepalive()
    for (let i = 0; i < 60; i++) {
      jest.advanceTimersByTime(i === 0 ? 15 : 17)
      const pending = frames.splice(0)
      for (const frame of pending) frame(performance.now())
    }
    expect(renderScene).toHaveBeenCalledTimes(60)
    expect(host.Graphics._maxSkip).toBe(3)
    expect(frames).toHaveLength(1)
  })

  it('honors engine stop and resumes fallback updates without installing a second timer', () => {
    ensureGameRenderKeepalive()
    scene._stopped = true
    jest.advanceTimersByTime(1000)
    expect(renderScene).not.toHaveBeenCalled()

    scene._stopped = false
    ensureGameRenderKeepalive()
    jest.advanceTimersByTime(1000)
    expect(renderScene.mock.calls.length).toBeGreaterThanOrEqual(59)
    expect(renderScene.mock.calls.length).toBeLessThanOrEqual(63)
    expect(frames).toHaveLength(1)
  })

  it('ticks the MZ graphics ticker so rendering and delta time remain engine-owned', () => {
    delete scene.requestUpdate
    const render = jest.fn()
    const update = jest.fn((_time: number) => render())
    const ticker = { started: true, update }
    host.Graphics = { _app: { ticker } }
    ensureGameRenderKeepalive()

    jest.advanceTimersByTime(1000)
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(55)
    expect(performance.now() - update.mock.calls.at(-1)![0]).toBeLessThan(17)
    expect(renderScene).not.toHaveBeenCalled()

    render.mockClear()
    ticker.started = false
    jest.advanceTimersByTime(1000)
    expect(render).not.toHaveBeenCalled()
  })
})
