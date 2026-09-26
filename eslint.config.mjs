import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import eslintConfigPrettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'dist/**',
    'tmp/**',
    'logs/**',
    'data/**',
    'node_modules/**',
    'plugins/dist/**',
    // 翻译管线 lib 仍为 @ts-nocheck 风格，避免假阳性
    'services/translate/lib/**',
    // local MVP smoke / demo
    '.mvp-demo-game/**',
    'mvp-demo-game/**',
    'demos/**',
    // Agent 约定只在 .agents/；跳过本地 .cursor
    '.cursor/**',
    // husky 钩子
    '.husky/**',
    'next-env.d.ts',
  ]),
  {
    plugins: {
      prettier: prettierPlugin,
      'simple-import-sort': simpleImportSortPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'max-len': [
        'error',
        {
          code: 180,
          tabWidth: 2,
          ignoreTemplateLiterals: true,
          ignoreUrls: true,
          ignoreStrings: true,
        },
      ],
      semi: ['error', 'never'],
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Next 16 / React 19 编译器规则：现有 fetch-on-mount / ref 同步写法先不挡提交
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    files: [
      'plugins/**/*.{ts,js,mjs}',
      'scripts/**/*.{js,mjs,cjs}',
      '**/build.mjs',
      'services/translate/cli.ts',
      'services/translate/import-cache.ts',
      'services/extract/cli.ts',
      'services/extract/lib/main.ts',
    ],
    rules: {
      'no-console': 'off',
      'prefer-rest-params': 'off',
    },
  },
  {
    // Electron / 工具链入口为 CommonJS，允许 require
    files: ['scripts/**/*.cjs', 'electron/**/*.{cjs,js}', 'jest.config.cjs', '.lintstagedrc.cjs', 'commitlint.config.cjs', '.prettierrc.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
])

export default eslintConfig
