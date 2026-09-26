/** WebRTC ICE 辅助（对齐工单 gather-complete 整包 SDP） */

export async function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 2_500): Promise<void> {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    let timeout = 0
    const onChange = () => {
      if (peer.iceGatheringState !== 'complete') return
      clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }, timeoutMs)
    peer.addEventListener('icegatheringstatechange', onChange)
    onChange()
  })
}

/** 本机把 host candidate 归一到 127.0.0.1，减少 NW / 多网卡干扰 */
export function normalizeLocalWebRtcDescription(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (typeof window === 'undefined') return description
  const host = window.location.hostname
  if (host !== 'localhost' && host !== '127.0.0.1') return description
  const sdp = String(description.sdp || '')
  if (!sdp.includes('candidate:')) return description
  return {
    ...description,
    sdp: sdp.replace(/(\s)((?:[0-9]{1,3}\.){3}[0-9]{1,3})(\s)/g, (full, a, ip, b) => {
      if (ip === '127.0.0.1' || ip.startsWith('0.')) return full
      // 保留典型私网；本机环回优先由浏览器自己选。仅改写明显的非环回 host 行里的局域网？工单是一律改 127.0.0.1
      return `${a}127.0.0.1${b}`
    }),
  }
}

export function defaultPeerConfig(): RTCConfiguration {
  return {
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  }
}
