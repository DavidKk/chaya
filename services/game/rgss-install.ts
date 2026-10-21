import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { isRgssRuntimeInstalled, toolkitRgssBinary, toolkitRgssDir } from '@/lib/game/toolkit-data'
import { startDownloadJob } from '@/services/downloads/jobs'
import { downloadToFile, sha256File } from '@/services/downloads/resumable'

const run = promisify(execFile)
const REPO = 'mkxp-z/mkxp-z'
const API = `https://api.github.com/repos/${REPO}`
type Build = { id: number; head_sha: string; head_repository: { full_name: string }; event: string; conclusion: string }
type Artifact = { id: number; name: string; digest?: string; expired: boolean }

async function github<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  if (!res.ok) throw new Error(`mkxp-z GitHub API: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** Only successful dev pushes from the upstream repository; never pull-request artifacts. */
async function latestArtifact(signal: AbortSignal) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('mkxp-z automatic installation currently supports macOS arm64 / x64 only')
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const { workflow_runs: builds } = await github<{ workflow_runs: Build[] }>(`${API}/actions/workflows/autobuild.yml/runs?branch=dev&event=push&status=success&per_page=5`, signal)
  for (const build of builds) {
    if (build.event !== 'push' || build.conclusion !== 'success' || build.head_repository.full_name !== REPO) continue
    const { artifacts } = await github<{ artifacts: Artifact[] }>(`${API}/actions/runs/${build.id}/artifacts?per_page=100`, signal)
    const name = `mkxp-z.macos.${arch}.standalone.dev-${build.head_sha.slice(0, 7)}`
    const artifact = artifacts.find((item) => !item.expired && item.name === name)
    const sha256 = artifact?.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]
    if (artifact && sha256) return { artifact, sha256, version: `dev-${build.head_sha.slice(0, 7)}`, commit: build.head_sha, runId: build.id }
  }
  throw new Error('No verified, unexpired official mkxp-z macOS build is available')
}

let updateBuild: { until: number; request: ReturnType<typeof latestArtifact> } | undefined

/** Cache upstream metadata only; always re-read the installed build after an install. */
export async function getRgssShellUpdate() {
  try {
    if (!isRgssRuntimeInstalled()) return { available: false, upToDate: false }
    const current = JSON.parse(fs.readFileSync(path.join(path.dirname(toolkitRgssBinary()), 'build.json'), 'utf8')) as {
      commit?: string
      sha256?: string
      version?: string
      runId?: number
    }
    if (!updateBuild || updateBuild.until <= Date.now()) {
      const entry = { until: Date.now() + 5 * 60_000, request: latestArtifact(AbortSignal.timeout(30_000)) }
      updateBuild = entry
      void entry.request.catch(() => {
        if (updateBuild === entry) entry.until = Date.now() + 60_000
      })
    }
    const latest = await updateBuild.request
    const known = typeof current.runId === 'number' && Number.isFinite(current.runId) && !!current.commit && !!current.sha256
    const upToDate = known && (current.runId! > latest.runId || (current.commit === latest.commit && current.sha256 === latest.sha256))
    return { available: known && !upToDate, upToDate, currentVersion: current.version, latestVersion: latest.version }
  } catch {
    // Network / metadata failure is unknown, never evidence that a build is latest.
    return { available: false, upToDate: false }
  }
}

function findBinary(dir: string, depth = 0): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isFile() && /^mkxp-z(?:\.(?:aarch64|arm64|x86_64|universal))?$/.test(entry.name)) return file
    if (entry.isDirectory() && depth < 3) {
      const hit = findBinary(file, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

export function startRgssInstallJob() {
  return startDownloadJob('rgss-shell', async ({ signal, update }) => {
    const build = await latestArtifact(signal)
    const root = toolkitRgssDir()
    const cache = path.join(root, 'downloads', String(build.artifact.id))
    const archive = path.join(cache, 'runtime.zip')
    fs.mkdirSync(cache, { recursive: true })
    update({ phase: 'download', version: build.version })
    if (!fs.existsSync(archive) || (await sha256File(archive, signal)) !== build.sha256) {
      await downloadToFile(`https://nightly.link/${REPO}/actions/artifacts/${build.artifact.id}.zip`, archive, {
        signal,
        sha256: build.sha256,
        label: 'mkxp-z',
        onBytes: (progress) => update({ ...progress, phase: 'download', version: build.version }),
      })
    }
    signal.throwIfAborted()
    update({ phase: 'extract' })
    const stage = fs.mkdtempSync(path.join(root, 'install-'))
    try {
      await run('unzip', ['-q', archive, '-d', stage], { signal })
      const binary = findBinary(stage)
      if (!binary) throw new Error('The official mkxp-z archive contains no standalone binary')
      if (
        !fs.statSync(path.join(stage, 'stdlib')).isDirectory() ||
        !['ruby_classic_wrap.rb', 'win32_wrap.rb'].every((name) => fs.statSync(path.join(stage, 'scripts', 'preload', name)).isFile())
      ) {
        throw new Error('The official mkxp-z archive is missing Ruby runtime support files')
      }
      update({ phase: 'install' })
      const destination = toolkitRgssBinary()
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      for (const name of ['stdlib', 'scripts', 'LICENSE.txt']) {
        const source = path.join(stage, name)
        if (fs.existsSync(source)) fs.cpSync(source, path.join(path.dirname(destination), name), { recursive: true })
      }
      // Copy to a temporary file, then rename: an interrupted upgrade preserves the installed runtime.
      fs.copyFileSync(binary, `${destination}.new`)
      fs.chmodSync(`${destination}.new`, 0o755)
      signal.throwIfAborted()
      fs.renameSync(`${destination}.new`, destination)
      fs.writeFileSync(path.join(path.dirname(destination), 'build.json'), JSON.stringify({ ...build, installedAt: Date.now() }, null, 2))
      return { path: destination, version: build.version, runtime: 'mkxp-z' }
    } finally {
      fs.rmSync(stage, { recursive: true, force: true })
    }
  })
}
