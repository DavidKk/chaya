import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { DEFAULT_REMOTE_PLAY_HOST_SETTINGS, parseRemotePlayHostSettings, type RemotePlayHostSettings } from '@/lib/runtime/remote-play-settings'
import { createPublicConfigurationStore } from '@/services/storage/configuration.server'

export function readRemotePlayHostSettings(): RemotePlayHostSettings {
  const stored = createPublicConfigurationStore(toolkitDataDir()).read('remotePlayHost')
  return stored === null ? { ...DEFAULT_REMOTE_PLAY_HOST_SETTINGS } : parseRemotePlayHostSettings(stored)
}

export function updateRemotePlayHostSettings(value: unknown): RemotePlayHostSettings {
  const parsed = parseRemotePlayHostSettings(value)
  const raw = value as Partial<RemotePlayHostSettings>
  const next = readRemotePlayHostSettings()
  if (raw.launchMode !== undefined) next.launchMode = parsed.launchMode
  if (raw.muteHostAudio !== undefined) next.muteHostAudio = parsed.muteHostAudio
  if (raw.idleTimeoutSeconds !== undefined) next.idleTimeoutSeconds = parsed.idleTimeoutSeconds
  createPublicConfigurationStore(toolkitDataDir()).write('remotePlayHost', next)
  return next
}
