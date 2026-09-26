import { assessNwShellUpdate } from '@/services/game/nw-update'

const versions = {
  stable: 'v0.116.0',
  versions: [{ version: 'v0.116.0', files: ['osx-arm64'], flavors: ['normal'], components: { chromium: '153.0.8010.12' } }],
}

it('offers an upgrade only for a newer supported release', () => {
  expect(assessNwShellUpdate('152.0.8000.10', versions, 'osx-arm64').available).toBe(true)
  expect(assessNwShellUpdate('153.0.8010.9', versions, 'osx-arm64').available).toBe(true)
  expect(assessNwShellUpdate('153.0.8010.12', versions, 'osx-arm64').available).toBe(false)
  expect(assessNwShellUpdate('154.0.9000.1', versions, 'osx-arm64').available).toBe(false)
  expect(assessNwShellUpdate('152.0.8000.10', versions, 'win-x64').available).toBe(false)
})

it('hides upgrades when installed version or release metadata is unknown', () => {
  expect(assessNwShellUpdate('', versions, 'osx-arm64').available).toBe(false)
  expect(assessNwShellUpdate('0.115.0', versions, 'osx-arm64').available).toBe(false)
  expect(assessNwShellUpdate('152.0.8000.10', {}, 'osx-arm64').available).toBe(false)
})
