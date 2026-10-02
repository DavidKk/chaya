export interface ReleaseDownloads {
  /** Release page; also the fallback when an asset is missing */
  pageUrl: string
  version: string | null
  macArm64: string | null
  macX64: string | null
  winX64: string | null
}

interface GithubAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  html_url: string
  draft: boolean
  assets: GithubAsset[]
}

const REVALIDATE_SECONDS = 600

/** `https://github.com/owner/repo` → `owner/repo` */
function repoSlug(githubUrl: string): string | null {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)\/?$/.exec(githubUrl)
  return match ? match[1] : null
}

/** First suffix wins: zip first; dmg / exe only cover releases published before the zip switch */
function pickAsset(assets: GithubAsset[], suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    const hit = assets.find((asset) => asset.name.endsWith(suffix))
    if (hit) return hit.browser_download_url
  }
  return null
}

/**
 * Newest non-draft release (prereleases included: v0.x is published as prerelease,
 * so `/releases/latest` would skip it).
 */
export async function getLatestReleaseDownloads(githubUrl: string): Promise<ReleaseDownloads> {
  const fallbackPage = `${githubUrl}/releases`
  const empty: ReleaseDownloads = { pageUrl: fallbackPage, version: null, macArm64: null, macX64: null, winX64: null }

  const slug = repoSlug(githubUrl)
  if (!slug) return empty

  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases?per_page=10`, {
      headers,
      next: { revalidate: REVALIDATE_SECONDS },
    })
    if (!res.ok) return empty

    const releases = (await res.json()) as GithubRelease[]
    const release = releases.find((item) => !item.draft && item.assets.length > 0)
    if (!release) return empty

    const { assets } = release
    return {
      pageUrl: release.html_url,
      version: release.tag_name,
      macArm64: pickAsset(assets, ['-arm64-mac.zip', '-arm64.dmg']),
      macX64: pickAsset(assets, ['-x64-mac.zip', '-x64.dmg']),
      winX64: pickAsset(assets, ['-x64.zip', '-x64.exe']),
    }
  } catch {
    return empty
  }
}
