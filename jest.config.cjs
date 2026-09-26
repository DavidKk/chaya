const fs = require('fs')
const path = require('path')
const { pathsToModuleNameMapper } = require('ts-jest')

const rootTsconfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8'))
const paths = rootTsconfig.compilerOptions?.paths || {}

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  modulePathIgnorePatterns: ['<rootDir>/.mvp-demo-game/', '<rootDir>/mvp-demo-game/', '<rootDir>/demos/', '<rootDir>/release/', '<rootDir>/.electron-builder/'],
  testMatch: ['**/__tests__/**/*.spec.ts', '**/__tests__/**/*.spec.tsx'],
  moduleNameMapper: {
    // Specific mocks before `@/*` so they win (Jest uses first matching pattern)
    '^@/constants/paths$': '<rootDir>/__tests__/mocks/constants-paths.ts',
    ...pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
    '^@chaya-lib/(.*)$': '<rootDir>/lib/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  clearMocks: true,
  restoreMocks: true,
}
