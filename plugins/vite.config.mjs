/**
 * 局内插件 Vite 配置（自包含 IIFE，含 React；不依赖游戏页全局 / Next）。
 * 多入口 IIFE 需串行：`node plugins/build.mjs`（内部调用本配置）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

/**
 * Next client modules (next/link, next/navigation) read these at module init. Browser-hosted games have no `process`,
 * so they must be inlined; a `process` shim is not an option because plugins detect NW.js via `typeof process`.
 */
const NEXT_ENV_KEYS = [
  'NEXT_RUNTIME',
  '__NEXT_CACHE_COMPONENTS',
  '__NEXT_DEV_SERVER',
  '__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS',
  '__NEXT_I18N_SUPPORT',
  '__NEXT_LINK_NO_TOUCH_START',
  '__NEXT_MANUAL_CLIENT_BASE_PATH',
  '__NEXT_MANUAL_TRAILING_SLASH',
  '__NEXT_ROUTER_BASEPATH',
  '__NEXT_TRAILING_SLASH',
]
const nextEnvDefines = Object.fromEntries(NEXT_ENV_KEYS.map((key) => [`process.env.${key}`, 'undefined']))

/** @param {{ name: string, entry: string, react?: boolean }} entry */
/** @param {boolean} emptyOutDir */
/** @param {{ dev?: boolean }} [opts] */
export function createPluginsViteConfig(entry, emptyOutDir = false, opts = {}) {
  const useReact = entry.react !== false
  const isDev = !!opts.dev
  const useTailwind = entry.name === 'ChayaEdit'
  return defineConfig({
    root: __dirname,
    plugins: [...(useReact ? [react()] : []), ...(useTailwind ? [tailwindcss()] : [])],
    resolve: {
      alias: {
        '@': repoRoot,
        '@chaya-lib': path.resolve(repoRoot, 'lib'),
      },
      dedupe: ['react', 'react-dom'],
    },
    define: {
      // 局内 IIFE 始终打 production React，避免 development 体积把插件撑挂
      'process.env.NODE_ENV': JSON.stringify('production'),
      ...nextEnvDefines,
      __CHAYA_PLUGINS_DEV__: isDev,
      // 防止误打进 Node 包时在浏览器抛 ReferenceError
      __dirname: JSON.stringify('/'),
      __filename: JSON.stringify('/'),
    },
    // @tailwindcss/vite 用 css.devSourcemap 决定是否产出 CSS map；
    // 仅开 build.sourcemap 时会告警「transform 未生成 sourcemap」。
    css: {
      devSourcemap: isDev,
    },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir,
      lib: {
        entry: path.resolve(__dirname, entry.entry),
        name: entry.name.replace(/[^a-zA-Z0-9]/g, '_'),
        formats: ['iife'],
        fileName: () => `${entry.name}.js`,
      },
      rollupOptions: {
        external: [],
        output: {
          format: 'iife',
          name: entry.name.replace(/[^a-zA-Z0-9]/g, '_'),
          inlineDynamicImports: true,
          extend: false,
        },
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
      target: 'es2018',
      // lib 模式下须显式 esbuild；ChayaEdit 含 React，不压会大到同步 eval 失败
      minify: 'esbuild',
      sourcemap: isDev,
      cssCodeSplit: false,
    },
    logLevel: 'warn',
  })
}

/** 单入口默认配置（`vite build --config plugins/vite.config.mjs` 时打 ChayaEdit） */
export default createPluginsViteConfig({ name: 'ChayaEdit', entry: 'src/cheat/index.ts', react: true }, true)
