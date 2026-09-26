// @ts-nocheck
/** 翻译管线常量与客户端画像 */
export const ENGINE_NAMES = ['bing', 'google', 'ollama']

export const MODEL = 'gemma4:e2b-it-q4_K_M'
export const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
export const JAPANESE = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/
/** 假名字母（不含 「・」中点等标点，避免中文「・」误判） */
export const KANA_LETTER = /[\u3040-\u309F\u30A1-\u30FA\u30FC-\u30FF\u31F0-\u31FF\uFF66-\uFF9F]/

export const BING_CHUNK_CHARS = 2800
export const GOOGLE_CHUNK_CHARS = 1600
// 公网间隔再放宽一档试吞吐；撞限流会走 NET_BAN_GAP_STEPS 自动拉长。
export const NET_GAP_MIN_MS = 2500
export const NET_GAP_MAX_MS = 5500
export const NET_BAN_GAP_STEPS = [
  [12000, 22000],
  [22000, 40000],
  [40000, 75000],
  [75000, 130000],
]
export const NET_RETRY_RANGES = [
  [8000, 16000],
  [18000, 32000],
  [35000, 60000],
  [70000, 120000],
]

export const OLLAMA_CHUNK_CHARS = 1500
export const OLLAMA_CHUNK_LINES = 90
export const OLLAMA_NUM_CTX = 8192
// 运行期只追加 NDJSON 缓存；merged 结果等结束再统一生成。
export const CACHE_APPEND_MS = 5000

// 轮换客户端画像：同一出口 IP 时服务端仍多半按 IP 限流，UA 只能增加多样性，无法真的伪装成 N 台机器。
export const CLIENT_PROFILES = [
  {
    id: 'win-chrome',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6',
  },
  {
    id: 'win-edge',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    acceptLanguage: 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
  },
  {
    id: 'mac-chrome',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
  },
  {
    id: 'mac-safari',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    acceptLanguage: 'zh-CN,zh-Hans;q=0.9,ja;q=0.8,en;q=0.7',
  },
  {
    id: 'win-firefox',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    acceptLanguage: 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
  },
  {
    id: 'linux-chrome',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    acceptLanguage: 'en-US,en;q=0.9,zh-CN;q=0.8,ja;q=0.7',
  },
  {
    id: 'mac-firefox',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0',
    acceptLanguage: 'zh-CN,zh;q=0.9,ja;q=0.8,en-US;q=0.7',
  },
  {
    id: 'win-chrome-ja',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    acceptLanguage: 'ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7',
  },
]

export function nextClientProfile() {
  return CLIENT_PROFILES[Math.floor(Math.random() * CLIENT_PROFILES.length)]
}

export function browserHeaders(profile) {
  return {
    'User-Agent': profile.ua,
    'Accept-Language': profile.acceptLanguage,
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
  }
}

export const SYSTEM = [
  '把用户给出的日文逐行翻译成简体中文。',
  '每一行都以 ⟦数字⟧ 开头。必须原样保留这个编号，不要翻译、不要增删编号。',
  '只翻译编号后面的文字。一行一个编号，不要把多行合成一行，也不要拆成多行。',
  '文中的 __NAME__ / __ITEM__ / __SKILL__ / __WEAPON__ / __ARMOR__ / __STATE__ / __ENEMY__ 是词表占位符，必须原样保留。',
  '例如：⟦0⟧__NAME__は__ITEM__を使った → ⟦0⟧__NAME__使用了__ITEM__',
  '不要解释，不要 Markdown。保留原文里的符号、引号和占位符。',
].join('\n')

export const TOKEN = {
  name: '__NAME__',
  item: '__ITEM__',
  skill: '__SKILL__',
  weapon: '__WEAPON__',
  armor: '__ARMOR__',
  state: '__STATE__',
  enemy: '__ENEMY__',
}
