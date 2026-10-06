import { DEFAULT_SITE_ORIGIN } from '@/constants/brand'
import { repository, version } from '@/package.json'

const GITHUB_HOME = 'https://github.com'

function githubUrlFromRepository(repo: string | { url?: string } | undefined): string {
  const rawUrl = typeof repo === 'string' ? repo : repo?.url
  if (!rawUrl) return GITHUB_HOME
  const url = rawUrl
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
  return url.startsWith('https://github.com/') ? url : GITHUB_HOME
}

export const PRODUCT_VERSION: string = version
export const GITHUB_URL = githubUrlFromRepository(repository)
export const GITHUB_ISSUES_URL = GITHUB_URL === GITHUB_HOME ? GITHUB_HOME : `${GITHUB_URL}/issues`
export const GITHUB_CONTRIBUTORS_URL = GITHUB_URL === GITHUB_HOME ? GITHUB_HOME : `${GITHUB_URL}/graphs/contributors`
export const SITE_URL = DEFAULT_SITE_ORIGIN

type NwShell = { openExternal?: (url: string) => void }

/** NW.js 游戏窗口里用系统浏览器打开，避免把游戏页跳走；网页里新开标签 */
export function openExternal(url: string) {
  const shell = (globalThis as typeof globalThis & { nw?: { Shell?: NwShell } }).nw?.Shell
  if (shell?.openExternal) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}
