import { UPDATE_METADATA_URL } from '@/constants/updates'
import { assertOfficialAsset } from '@/lib/updates/protocol'

/** Follow only the official asset redirect chain, without forwarding credentials. */
export const fetchOfficialAsset: typeof fetch = async (input, init) => {
  let url = String(input)
  assertOfficialAsset(url)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { ...init, redirect: 'manual', credentials: 'omit' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location) throw new Error('GitHub redirect is missing a location')
    const next = new URL(location, url)
    if (next.protocol !== 'https:' || next.username || next.password || next.port || next.hash) throw new Error('Unsafe update redirect')
    if (next.hostname === 'github.com') assertOfficialAsset(next.href)
    else if (next.hostname !== 'release-assets.githubusercontent.com' && next.hostname !== 'objects.githubusercontent.com') throw new Error('Untrusted update redirect')
    url = next.href
  }
  throw new Error('Too many GitHub redirects')
}

export function assertMetadataUrl(url: string): void {
  if (!url.startsWith(UPDATE_METADATA_URL) || !/^(?:\d+\.)?(?:root|timestamp|snapshot|targets)\.json$/.test(url.slice(UPDATE_METADATA_URL.length))) {
    throw new Error('Unexpected metadata location')
  }
}
