import { redirect } from 'next/navigation'

import { MarketingHome } from '@/components/MarketingHome'
import { GITHUB_URL } from '@/lib/about'
import { getLatestReleaseDownloads } from '@/lib/release/github-release'
import { canUseDisk } from '@/lib/service-mode'

/**
 * `/`：
 * - local / app（含 Electron）：进游戏库控制台
 * - edge（vercel）：官方介绍 / 下载页
 */
export default async function Home() {
  if (canUseDisk()) {
    redirect('/game')
  }
  const downloads = await getLatestReleaseDownloads(GITHUB_URL)
  return <MarketingHome githubUrl={GITHUB_URL} downloads={downloads} />
}
