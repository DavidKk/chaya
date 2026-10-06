export type CreditGroupId = 'platform' | 'ui' | 'text' | 'ai' | 'build' | 'assets'

export type Credit = {
  name: string
  url: string
  /** SPDX 标识；CC BY 素材须保留署名 */
  license: string
  /** 需署名的作者 */
  author?: string
}

export type CreditGroup = { id: CreditGroupId; items: readonly Credit[] }

/** 「关于 → 致谢」与 /license 页列出的主要开源工具；增删依赖时同步 */
export const CREDIT_GROUPS: readonly CreditGroup[] = [
  {
    id: 'platform',
    items: [
      { name: 'NW.js', url: 'https://nwjs.io', license: 'MIT' },
      { name: 'Electron', url: 'https://www.electronjs.org', license: 'MIT' },
      { name: 'Node.js', url: 'https://nodejs.org', license: 'MIT' },
      { name: 'Next.js', url: 'https://nextjs.org', license: 'MIT' },
      { name: 'React', url: 'https://react.dev', license: 'MIT' },
    ],
  },
  {
    id: 'ui',
    items: [
      { name: 'Tailwind CSS', url: 'https://tailwindcss.com', license: 'MIT' },
      { name: 'Base UI', url: 'https://base-ui.com', license: 'MIT' },
      { name: 'shadcn/ui', url: 'https://ui.shadcn.com', license: 'MIT' },
      { name: 'Shiki', url: 'https://shiki.style', license: 'MIT' },
      { name: 'Marked', url: 'https://marked.js.org', license: 'MIT' },
    ],
  },
  {
    id: 'text',
    items: [
      { name: 'kuromoji.js', url: 'https://github.com/takuyaa/kuromoji.js', license: 'Apache-2.0' },
      { name: 'bing-translate-api', url: 'https://github.com/plainheart/bing-translate-api', license: 'MIT' },
      { name: 'Drizzle ORM', url: 'https://orm.drizzle.team', license: 'Apache-2.0' },
      { name: 'fflate', url: 'https://github.com/101arrowz/fflate', license: 'MIT' },
      { name: 'sharp', url: 'https://sharp.pixelplumbing.com', license: 'Apache-2.0' },
      { name: 'undici', url: 'https://undici.nodejs.org', license: 'MIT' },
    ],
  },
  {
    id: 'ai',
    items: [
      { name: 'Ollama', url: 'https://ollama.com', license: 'MIT' },
      { name: 'Model Context Protocol', url: 'https://modelcontextprotocol.io', license: 'MIT' },
    ],
  },
  {
    id: 'build',
    items: [
      { name: 'TypeScript', url: 'https://www.typescriptlang.org', license: 'Apache-2.0' },
      { name: 'Vite', url: 'https://vite.dev', license: 'MIT' },
      { name: 'esbuild', url: 'https://esbuild.github.io', license: 'MIT' },
      { name: 'Jest', url: 'https://jestjs.io', license: 'MIT' },
      { name: 'ESLint', url: 'https://eslint.org', license: 'MIT' },
      { name: 'Prettier', url: 'https://prettier.io', license: 'MIT' },
    ],
  },
  {
    id: 'assets',
    items: [
      { name: 'react-icons', url: 'https://react-icons.github.io/react-icons', license: 'MIT' },
      { name: 'Lucide', url: 'https://lucide.dev', license: 'ISC' },
      { name: 'Ionicons', url: 'https://ionic.io/ionicons', license: 'MIT' },
      { name: 'Game-icons.net', url: 'https://game-icons.net', license: 'CC-BY-3.0', author: 'Lorc, Delapouite et al.' },
      { name: 'Font Awesome Free', url: 'https://fontawesome.com', license: 'CC-BY-4.0', author: 'Fonticons, Inc.' },
      { name: 'VS Code Codicons', url: 'https://github.com/microsoft/vscode-codicons', license: 'CC-BY-4.0', author: 'Microsoft' },
      { name: 'Remix Icon', url: 'https://remixicon.com', license: 'Apache-2.0' },
      { name: 'Material Design Icons', url: 'https://fonts.google.com/icons', license: 'Apache-2.0' },
      { name: 'Grommet Icons', url: 'https://github.com/grommet/grommet-icons', license: 'Apache-2.0' },
      { name: 'Tabler Icons', url: 'https://tabler.io/icons', license: 'MIT' },
      { name: 'Heroicons', url: 'https://heroicons.com', license: 'MIT' },
      { name: 'Boxicons', url: 'https://boxicons.com', license: 'MIT' },
      { name: 'Simple Icons', url: 'https://simpleicons.org', license: 'CC0-1.0' },
      { name: 'Outfit', url: 'https://fonts.google.com/specimen/Outfit', license: 'OFL-1.1' },
      { name: 'Manrope', url: 'https://fonts.google.com/specimen/Manrope', license: 'OFL-1.1' },
      { name: 'JetBrains Mono', url: 'https://www.jetbrains.com/lp/mono', license: 'OFL-1.1' },
    ],
  },
]
