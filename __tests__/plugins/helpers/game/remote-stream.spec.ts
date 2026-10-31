/**
 * @jest-environment jsdom
 */
import { attachGameMediaStream, captureGameMediaStream, handleRemoteInput, handleRemoteTap } from '@/plugins/mv/src/helpers/game/remote-stream'

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

  it('attachGameMediaStream attaches captured tracks to transceivers', () => {
    const canvas = document.createElement('canvas')
    canvas.id = 'GameCanvas'
    document.body.appendChild(canvas)

    const mockVideoTrack = { kind: 'video' } as MediaStreamTrack
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
      getTransceivers: jest.fn(() => [mockTransceiver]),
      addTrack: jest.fn(),
    } as unknown as RTCPeerConnection

    attachGameMediaStream(mockPeer)
    expect(mockTransceiver.direction).toBe('sendonly')
    expect(replaceTrackMock).toHaveBeenCalledWith(mockVideoTrack)
  })
})
