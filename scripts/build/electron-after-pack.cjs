'use strict'

/**
 * Ensure a usable macOS signature after pack: apply ad-hoc if unsigned.
 * Prefer afterPack over afterSign — afterSign may not run when signing is skipped.
 * electron-builder may re-sign afterward when a real identity is configured.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  const verify = () =>
    spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      encoding: 'utf8',
    })

  if (verify().status === 0) {
    console.log(`[after-pack] mac signature already valid: ${appPath}`)
    return
  }

  console.log(`[after-pack] signature missing/invalid → ad-hoc: ${appPath}`)
  const sign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], {
    encoding: 'utf8',
  })
  if (sign.status !== 0) {
    throw new Error(`ad-hoc codesign failed: ${sign.stderr || sign.stdout || sign.error}`)
  }
  const result = verify()
  if (result.status !== 0) {
    throw new Error(`codesign --verify still failing: ${result.stderr || result.stdout}`)
  }
  console.log('[after-pack] mac ad-hoc signature ok')
}
