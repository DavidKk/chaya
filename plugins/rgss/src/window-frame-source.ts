type FramePacket = { generation: string; sequence?: number; image?: string; error?: string }
type CaptureWindow = Window & {
  webkit?: { messageHandlers?: { chaya?: { postMessage: (json: string) => void } } }
  __chaya_stream_frame?: (packet: FramePacket) => void
}

/** One bounded native capture feeds every live peer; previews never enter this path. */
export class WindowFrameSource {
  private canvas: HTMLCanvasElement | null = null
  private stream: MediaStream | null = null
  private pending: Promise<MediaStream> | null = null
  private reject: ((error: Error) => void) | null = null
  private disposeCallback: (() => void) | null = null
  private generation = ''
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private onError: (message: string) => void = (message) => console.warn('[RGSS capture]', message)) {}

  start(): Promise<MediaStream> {
    if (this.pending) return this.pending
    if (this.stream?.active) return Promise.resolve(this.stream)
    const host = window as CaptureWindow
    const sender = host.webkit?.messageHandlers?.chaya
    if (!sender) return Promise.reject(new Error('Native live window capture is unavailable on this host'))
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.generation = generation
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    this.canvas = canvas
    if (typeof canvas.captureStream !== 'function') {
      this.canvas = null
      this.generation = ''
      return Promise.reject(new Error('Canvas streaming is unavailable on this host'))
    }
    this.stream = canvas.captureStream(30)
    const previous = host.__chaya_stream_frame
    let loading = false
    this.pending = new Promise<MediaStream>((resolve, reject) => {
      this.reject = reject
      const receive = (packet: FramePacket) => {
        if (this.generation !== generation || packet.generation !== generation) return
        if (packet.error) {
          this.onError(packet.error)
          this.stop(packet.error)
          return
        }
        const ack = () => sender.postMessage(JSON.stringify({ type: 'host.stream.ack', generation, sequence: packet.sequence }))
        if (loading || !packet.image?.startsWith('data:image/jpeg;base64,')) {
          ack()
          return
        }
        loading = true
        const image = new Image()
        image.onload = () => {
          loading = false
          if (this.generation !== generation) return
          try {
            if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 1280 || image.naturalHeight > 1280) throw new Error('Invalid native frame dimensions')
            if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth
            if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')
            if (!context) throw new Error('Window capture canvas is unavailable')
            context.drawImage(image, 0, 0)
            if (this.timer) clearTimeout(this.timer)
            this.timer = null
            this.reject = null
            resolve(this.stream!)
          } catch (error) {
            this.onError(String(error))
            this.stop(String(error))
          } finally {
            ack()
          }
        }
        image.onerror = () => {
          loading = false
          if (this.generation === generation) ack()
        }
        image.src = packet.image
      }
      host.__chaya_stream_frame = receive
      this.disposeCallback = () => {
        if (host.__chaya_stream_frame === receive) host.__chaya_stream_frame = previous
      }
      this.timer = setTimeout(() => {
        if (this.generation !== generation) return
        this.onError('Native window capture first frame timed out')
        this.stop('Native window capture first frame timed out')
      }, 6000)
    })
    // Send after installing the callback, including when a native test responds synchronously.
    const pending = this.pending
    try {
      sender.postMessage(JSON.stringify({ type: 'host.stream', active: true, generation }))
    } catch (error) {
      this.onError(String(error))
      this.stop(String(error))
    }
    return pending
  }

  stop(reason = 'Native window capture stopped before its first frame'): void {
    const generation = this.generation
    this.generation = ''
    this.disposeCallback?.()
    this.disposeCallback = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (generation) {
      try {
        ;(window as CaptureWindow).webkit?.messageHandlers?.chaya?.postMessage(JSON.stringify({ type: 'host.stream', active: false, generation }))
      } catch {
        /* The host may already be shutting down. */
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.canvas = null
    this.reject?.(new Error(reason))
    this.reject = null
    this.pending = null
  }
}
