export type RemotePlayHostSettings = {
  launchMode: 'windowed' | 'silent'
  muteHostAudio: boolean
  idleTimeoutSeconds?: number
}

export const DEFAULT_REMOTE_PLAY_HOST_SETTINGS: Readonly<RemotePlayHostSettings> = {
  launchMode: 'windowed',
  muteHostAudio: true,
}

export function parseRemotePlayHostSettings(value: unknown): RemotePlayHostSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid remote play host settings')
  const raw = value as Record<string, unknown>
  if (raw.launchMode !== undefined && raw.launchMode !== 'windowed' && raw.launchMode !== 'silent') throw new Error('Invalid launch mode')
  if (raw.muteHostAudio !== undefined && typeof raw.muteHostAudio !== 'boolean') throw new Error('Invalid host audio setting')
  if (raw.idleTimeoutSeconds !== undefined) {
    if (typeof raw.idleTimeoutSeconds !== 'number' || !Number.isFinite(raw.idleTimeoutSeconds) || raw.idleTimeoutSeconds < 0 || raw.idleTimeoutSeconds > 86400) {
      throw new Error('Invalid idle timeout')
    }
  }
  return {
    launchMode: raw.launchMode ?? DEFAULT_REMOTE_PLAY_HOST_SETTINGS.launchMode,
    muteHostAudio: raw.muteHostAudio ?? DEFAULT_REMOTE_PLAY_HOST_SETTINGS.muteHostAudio,
    ...(raw.idleTimeoutSeconds !== undefined ? { idleTimeoutSeconds: Math.floor(raw.idleTimeoutSeconds) } : {}),
  }
}
