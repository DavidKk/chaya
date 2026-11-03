import { encodeGameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { defaultPeerConfig, normalizeLocalWebRtcDescription, waitForIceGathering } from '@/lib/runtime/webrtc-ice'

export type SpectatorOffer = { peerId: string; offer?: RTCSessionDescriptionInit | null }
type Entry = { peer: RTCPeerConnection; sdp: string; channel?: RTCDataChannel }

/** Spectators share media but never dispatch game commands to Ruby. */
export class SpectatorPeers {
  private entries = new Map<string, Entry>()

  constructor(
    private roomId: string,
    private attach: (peer: RTCPeerConnection) => Promise<void>,
    private release: (peer: RTCPeerConnection) => void,
    private publish: (peerId: string, sdp: RTCSessionDescriptionInit) => Promise<boolean>
  ) {}

  private close(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    entry.peer.ondatachannel = entry.peer.onconnectionstatechange = null
    if (entry.channel) {
      entry.channel.onopen = entry.channel.onclose = entry.channel.onmessage = null
      try {
        entry.channel.close()
      } catch {
        /* Already closed. */
      }
    }
    try {
      entry.peer.close()
    } catch {
      /* Already closed. */
    }
    this.release(entry.peer)
  }

  stop() {
    for (const id of this.entries.keys()) this.close(id)
  }

  async sync(offers: SpectatorOffer[], active: () => boolean) {
    const ids = new Set(offers.map((item) => item.peerId))
    for (const id of this.entries.keys()) if (!ids.has(id)) this.close(id)
    await Promise.all(
      offers.map(async ({ peerId, offer }) => {
        if (!active() || !offer?.sdp || !offer.type) return
        if (this.entries.get(peerId)?.sdp === offer.sdp) return
        this.close(peerId)
        const peer = new RTCPeerConnection(defaultPeerConfig())
        const entry: Entry = { peer, sdp: offer.sdp }
        this.entries.set(peerId, entry)
        const current = () => active() && this.entries.get(peerId) === entry
        peer.onconnectionstatechange = () => {
          if (current() && ['failed', 'closed'].includes(peer.connectionState)) this.close(peerId)
        }
        peer.ondatachannel = ({ channel }) => {
          if (!current()) {
            channel.close()
            return
          }
          entry.channel = channel
          channel.onopen = () => {
            if (current()) channel.send(encodeGameLinkMessage({ type: 'hello', role: 'game', gameId: this.roomId, isController: false, spectator: true }))
          }
          channel.onclose = () => {
            if (current()) this.close(peerId)
          }
          channel.onmessage = ({ data }) => {
            if (!current() || channel.readyState !== 'open') return
            const message = parseGameLinkMessage(String(data || ''))
            if (message?.type === 'ping') channel.send(encodeGameLinkMessage({ type: 'pong', t: message.t }))
          }
        }
        try {
          await peer.setRemoteDescription(offer)
          if (!current()) return
          if (offer.sdp.includes('m=video')) await this.attach(peer)
          if (!current()) return
          await peer.setLocalDescription(await peer.createAnswer())
          await waitForIceGathering(peer)
          if (!current()) return
          if (!(await this.publish(peerId, normalizeLocalWebRtcDescription(peer.localDescription!.toJSON()))) && current()) this.close(peerId)
        } catch (error) {
          if (current()) this.close(peerId)
          console.warn('[RGSS WebRTC Gateway] Spectator handshake failed:', error)
        }
      })
    )
  }
}
