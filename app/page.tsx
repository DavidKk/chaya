import { redirect } from 'next/navigation'

import { MarketingHome } from '@/components/MarketingHome'
import { getLatestReleaseDownloads } from '@/lib/release/github-release'
import { canUseDisk } from '@/lib/service-mode'
import packageJson from '@/package.json'

const GITHUB_HOME = 'https://github.com'

function githubUrlFromPackage() {
  const repository = (packageJson as { repository?: string | { url?: string } }).repository
  const rawUrl = typeof repository === 'string' ? repository : repository?.url
  if (!rawUrl) return GITHUB_HOME

  const url = rawUrl
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
  return url.startsWith('https://github.com/') ? url : GITHUB_HOME
}

/**
 * `/`：
 * - local / app（含 Electron）：进游戏库控制台
 * - edge（vercel）：官方介绍 / 下载页
 */
export default async function Home() {
  if (canUseDisk()) {
    redirect('/game')
  }
  const githubUrl = githubUrlFromPackage()
  const downloads = await getLatestReleaseDownloads(githubUrl)
  return <MarketingHome githubUrl={githubUrl} downloads={downloads} />
}
