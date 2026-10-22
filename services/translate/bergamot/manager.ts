import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { bergamotLanguage, isActivePackJob, type PackJob, type PackPlan } from '@/lib/translate/bergamot'

import { resolveBergamotBinary } from './binary'
import { bergamotPlatformSupported, findPack } from './catalog'
import { downloadPackFile, hashFile, unpackFile } from './download'
import { validateBergamotPack } from './native'
import { verifiedPack } from './readiness'
import { atomicJson, contentId, installationRoot, type InstalledManifest, installedPack, packBytes, packsRoot, pairFolder, syncDirectory } from './store'

/** The disk lock spans the entire operation, including publication. Different server workers never overlap. */
class PackManager {
  private current?: { job: PackJob; controller: AbortController }
  private jobsDir = path.join(packsRoot(), 'jobs')
  private lock = path.join(packsRoot(), 'installer.lock')

  private save(job: PackJob) {
    job.updatedAt = Date.now()
    job.revision++
    atomicJson(path.join(this.jobsDir, `${job.id}.json`), job)
  }
  private ownerAlive() {
    try {
      const owner = JSON.parse(fs.readFileSync(this.lock, 'utf8')) as { pid: number }
      try {
        process.kill(owner.pid, 0)
        return true
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    } catch {
      return fs.existsSync(this.lock)
    }
  }
  private latest(planId: string): PackJob | undefined {
    if (!fs.existsSync(this.jobsDir)) return
    const jobs: PackJob[] = []
    for (const name of fs.readdirSync(this.jobsDir)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue
      try {
        const job = JSON.parse(fs.readFileSync(path.join(this.jobsDir, name), 'utf8')) as PackJob
        if (job.planId !== planId) continue
        if (isActivePackJob(job) && !this.ownerAlive()) {
          job.state = installedPack(job.source, job.target) ? 'completed' : 'interrupted'
          job.phase = null
          this.save(job)
          if (/^[a-f0-9-]+$/.test(job.id)) fs.rmSync(path.join(packsRoot(), 'staging', job.id), { recursive: true, force: true })
        }
        jobs.push(job)
      } catch {
        /* A corrupt snapshot cannot authorize a write. */
      }
    }
    return jobs.sort((a, b) => b.updatedAt - a.updatedAt)[0]
  }
  async plan(source: string, target: string): Promise<PackPlan> {
    source = bergamotLanguage(source)
    target = bergamotLanguage(target)
    const pack = findPack(source, target)
    let available = true
    try {
      resolveBergamotBinary()
    } catch {
      available = false
    }
    const installed = !!(await verifiedPack(source, target))
    const id = contentId({ source, target, pack, platform: `${process.platform}-${process.arch}` })
    const downloadBytes = pack ? packBytes(pack) : 0
    return {
      id,
      source,
      target,
      installed,
      canInstall: !!pack && available && !installed,
      status:
        source === target
          ? 'same_language'
          : !bergamotPlatformSupported() && !installed
            ? 'platform_unsupported'
            : !available
              ? 'component_unavailable'
              : installed
                ? 'ready'
                : pack
                  ? 'model_pack_missing'
                  : 'unsupported_pair',
      downloadBytes,
      requiredFreeBytes: pack ? downloadBytes + pack.files.reduce((sum, file) => sum + file.unpackedBytes, 0) + 16 * 1024 * 1024 : 0,
      packs: pack ? [{ id: pack.id, source, target, installed, bytes: downloadBytes, license: pack.license, licenseUrl: pack.licenseUrl, attribution: pack.attribution }] : [],
      job: this.latest(id),
    }
  }
  async install(source: string, target: string, planId: string) {
    const plan = await this.plan(source, target)
    if (plan.id !== planId) throw new Error('PACK_PLAN_CHANGED')
    if (plan.job && isActivePackJob(plan.job)) return plan
    if (!plan.canInstall) throw new Error('PACK_NOT_INSTALLABLE')
    fs.mkdirSync(packsRoot(), { recursive: true, mode: 0o700 })
    if (fs.existsSync(this.lock)) {
      if (this.ownerAlive()) throw new Error('PACK_INSTALL_BUSY')
      fs.unlinkSync(this.lock)
    }
    const fd = fs.openSync(this.lock, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }))
    } catch (error) {
      fs.rmSync(this.lock, { force: true })
      throw error
    } finally {
      fs.closeSync(fd)
    }
    const job: PackJob = {
      id: randomUUID(),
      planId,
      source: plan.source,
      target: plan.target,
      packIds: plan.packs.map((pack) => pack.id),
      state: 'queued',
      phase: null,
      downloadedBytes: 0,
      totalDownloadBytes: plan.downloadBytes,
      revision: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    const controller = new AbortController()
    this.current = { job, controller }
    try {
      this.save(job)
    } catch (error) {
      fs.rmSync(this.lock, { force: true })
      this.current = undefined
      throw error
    }
    void this.run(job, controller, plan.requiredFreeBytes)
    return { ...plan, job: { ...job } }
  }
  async cancel(source: string, target: string, jobId: string) {
    const plan = await this.plan(source, target)
    if (!plan.job || plan.job.id !== jobId) throw new Error('PACK_JOB_NOT_FOUND')
    if (!isActivePackJob(plan.job)) return plan
    // Persisted signal also reaches an installer owned by another server worker.
    atomicJson(path.join(this.jobsDir, `${jobId}.cancel`), { cancel: true })
    if (this.current?.job.id === jobId) this.current.controller.abort()
    return plan
  }
  private async run(job: PackJob, controller: AbortController, requiredBytes: number) {
    const stage = path.join(packsRoot(), 'staging', job.id)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)])
    const cancelFile = path.join(this.jobsDir, `${job.id}.cancel`)
    const poll = setInterval(() => {
      if (fs.existsSync(cancelFile)) controller.abort()
    }, 200)
    poll.unref()
    try {
      const pack = findPack(job.source, job.target)!
      const space = fs.statfsSync(packsRoot())
      if (space.bavail * space.bsize < requiredBytes) throw new Error('PACK_DISK_SPACE')
      const folder = path.join(stage, pairFolder(job.source, job.target))
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
      job.state = 'running'
      job.phase = 'downloading'
      this.save(job)
      let lastSave = 0
      for (const file of pack.files) {
        signal.throwIfAborted()
        job.phase = 'downloading'
        job.currentFile = file.name
        this.save(job)
        const archive = path.join(stage, file.name + '.gz')
        await downloadPackFile(file, archive, signal, (bytes) => {
          job.downloadedBytes += bytes
          if (Date.now() - lastSave > 250) {
            this.save(job)
            lastSave = Date.now()
          }
        })
        job.phase = 'verifying'
        this.save(job)
        await unpackFile(file, archive, path.join(folder, file.name), signal)
        fs.unlinkSync(archive)
      }
      fs.writeFileSync(path.join(folder, 'config.yml'), pack.config, { flag: 'wx', mode: 0o600 })
      job.phase = 'validating'
      this.save(job)
      await validateBergamotPack(stage, pack.source, pack.target, pack.sample, signal)
      const files: InstalledManifest['files'] = []
      for (const name of [...pack.files.map((file) => file.name), 'config.yml']) {
        const file = path.join(folder, name)
        const fd = fs.openSync(file, 'r')
        try {
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
        const stat = fs.statSync(file)
        files.push({ name, bytes: stat.size, mtimeMs: stat.mtimeMs, sha256: await hashFile(file) })
      }
      syncDirectory(folder)
      const reference = { packId: pack.id, version: pack.version, installId: job.id }
      const manifest: InstalledManifest = { reference, source: pack.source, target: pack.target, binaryHash: await hashFile(resolveBergamotBinary()), files }
      atomicJson(path.join(stage, 'manifest.json'), manifest)
      signal.throwIfAborted()
      if (fs.existsSync(cancelFile)) throw new Error('PACK_CANCELLED')
      // No await from final cancellation check through active-reference commit.
      job.phase = 'publishing'
      this.save(job)
      const destination = installationRoot(reference)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.renameSync(stage, destination)
      for (let directory = path.dirname(destination); directory.startsWith(packsRoot()); directory = path.dirname(directory)) {
        syncDirectory(directory)
        if (directory === packsRoot()) break
      }
      atomicJson(path.join(packsRoot(), 'active', `${pack.id}.json`), reference)
      job.state = 'completed'
    } catch (error) {
      job.state = controller.signal.aborted ? 'cancelled' : 'failed'
      const code = (error as NodeJS.ErrnoException)?.code
      job.error = controller.signal.aborted
        ? 'PACK_CANCELLED'
        : code === 'ENOSPC'
          ? 'PACK_DISK_SPACE'
          : code === 'EACCES' || code === 'EPERM'
            ? 'PACK_PERMISSION_DENIED'
            : signal.aborted
              ? 'PACK_DOWNLOAD_TIMEOUT'
              : error instanceof Error
                ? error.message
                : 'PACK_INSTALL_FAILED'
    } finally {
      clearInterval(poll)
      job.phase = null
      try {
        this.save(job)
      } catch {
        /* Recovery reconciles publication if disk writes fail. */
      }
      for (const file of [stage, cancelFile, this.lock]) {
        try {
          fs.rmSync(file, { recursive: true, force: true })
        } catch {
          /* Never turn a terminal task into an unhandled rejection. */
        }
      }
      this.current = undefined
    }
  }
}
const globalPacks = globalThis as typeof globalThis & { chayaPackManagers?: Map<string, PackManager> }
export function packManager() {
  const managers = (globalPacks.chayaPackManagers ??= new Map())
  const root = packsRoot()
  let manager = managers.get(root)
  if (!manager) {
    manager = new PackManager()
    managers.set(root, manager)
  }
  return manager
}
