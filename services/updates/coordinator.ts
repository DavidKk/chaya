import fs from 'node:fs'
import path from 'node:path'

import { ROOT_PATH, UPDATES_DIR } from '@/constants/paths'
import { parseOfflineUpdate } from '@/lib/updates/offline'
import { assertCompatible, comparePackageVersions, packageVersion, parseUpdatePackage, safePackageId, selectUpdates, type UpdatePackage } from '@/lib/updates/protocol'
import { type DownloadJobControl, startDownloadJob } from '@/services/downloads/jobs'
import { downloadToFile, sha256File } from '@/services/downloads/resumable'

import { type ResourceUpdatePort, resourceUpdatePort, validateResourceUpdate } from './resources'
import { createTrustedSource, type TrustedSource } from './source'
import { type UpdateState, withUpdateState } from './state'
import { fetchOfficialAsset } from './transport'

type Options = { directory: string; source: TrustedSource; resources: ResourceUpdatePort; fetch?: typeof fetch }

/** One coordinator per data directory. Translation readers never acquire this lock. */
export function createUpdateCoordinator(options: Options) {
  const { directory, resources, source } = options
  const versionDirectory = (item: UpdatePackage) => path.join(directory, 'packages', safePackageId(item.packageId), packageVersion(item.packageVersion))
  const installedFile = (item: UpdatePackage) => path.join(versionDirectory(item), 'content.jsonl')
  const stagedFile = (item: UpdatePackage) => path.join(directory, 'staging', `${item.packageId}-${item.packageVersion}.jsonl`)
  const downloadFile = (item: UpdatePackage) => path.join(directory, 'downloads', `${item.packageId}-${item.packageVersion}.jsonl`)
  async function verify(item: UpdatePackage, file: string) {
    if (fs.statSync(file).size !== item.length || (await sha256File(file)) !== item.sha256) throw new Error('Installed update content failed integrity verification')
    const content = fs.readFileSync(file, 'utf8')
    validateResourceUpdate(item, content)
    return content
  }
  async function finishInstall(state: UpdateState, item: UpdatePackage) {
    if (!fs.existsSync(installedFile(item))) {
      const candidate = [stagedFile(item), downloadFile(item)].find((file) => fs.existsSync(file))
      if (!candidate) throw new Error('Installation content is missing; retry download')
      await verify(item, candidate)
      fs.mkdirSync(versionDirectory(item), { recursive: true })
      fs.renameSync(candidate, installedFile(item))
    }
    const content = await verify(item, installedFile(item))
    resources.install(content)
    state.save(item, 'installed')
    state.event(item, 'installed')
  }
  async function finishActivation(state: UpdateState, item: UpdatePackage, action: string) {
    await verify(item, installedFile(item))
    // Resource storage is authoritative. Repeating this after a crash is safe.
    resources.activate(item.resource!.packId, item.resource!.version)
    state.save(item, 'installed')
    state.event(item, action)
  }
  async function recover(state: UpdateState) {
    for (const record of state.list()) {
      if (record.phase === 'installed' || record.phase === 'error') continue
      const item = parseUpdatePackage(record.descriptor)
      let activationVerified = false
      try {
        assertCompatible(item)
        if (record.phase === 'downloading') {
          state.save(item, 'error', 'Download interrupted; retry installation to resume')
        } else if (record.phase === 'installing') {
          await finishInstall(state, item)
        } else {
          await verify(item, installedFile(item))
          activationVerified = true
          await finishActivation(state, item, 'activation-recovered')
        }
      } catch (error) {
        state.save(item, activationVerified ? 'installed' : 'error', error instanceof Error ? error.message : String(error))
      }
    }
  }
  const locked = <T>(run: (state: UpdateState) => Promise<T>) =>
    withUpdateState(directory, async (state) => {
      await recover(state)
      return run(state)
    })

  async function installFromCatalog(state: UpdateState, id: string, version: string, catalog: UpdatePackage[], control?: DownloadJobControl, suppliedContent?: string) {
    safePackageId(id)
    packageVersion(version)
    // Validate all identities before selecting a specifically requested version.
    selectUpdates(catalog)
    const candidate = catalog.find((item) => item.packageId === id && item.packageVersion === version)
    if (!candidate) throw new Error('Requested package is not in the current trusted catalog')
    const item = parseUpdatePackage(candidate)
    assertCompatible(item)
    if (item.kind !== 'translation-resource') throw new Error('Matching capability installation is not enabled in this delivery')
    const existing = state.list().filter((row) => row.descriptor.packageId === id)
    if (existing.some((row) => row.phase === 'installed' && comparePackageVersions(row.descriptor.packageVersion, version) > 0)) {
      throw new Error('Remote version downgrade rejected; use explicit local rollback')
    }
    const same = existing.find((row) => row.descriptor.packageVersion === version)
    if (same?.phase === 'installed') {
      state.save(item, 'installed')
      await verify(item, installedFile(item))
      return { packageId: id, version, reused: true }
    }
    // Persist identity before accepting retained bytes or creating new files.
    state.save(item, 'downloading')
    control?.update({ packageId: id, version, phase: 'download' })
    try {
      const retained = [installedFile(item), stagedFile(item)].find((file) => fs.existsSync(file))
      if (retained) {
        await verify(item, retained)
        state.save(item, 'installing')
        await finishInstall(state, item)
        return { packageId: id, version, reused: true }
      }
      const download = downloadFile(item)
      if (suppliedContent !== undefined) {
        // Bytes still pass the signed hash, size and schema checks below.
        fs.mkdirSync(path.dirname(download), { recursive: true })
        fs.writeFileSync(download, suppliedContent, { mode: 0o600 })
      }
      if (fs.existsSync(download)) {
        try {
          await verify(item, download)
        } catch (error) {
          fs.rmSync(download)
          throw error
        }
      } else
        await downloadToFile(item.url, download, {
          signal: control?.signal,
          expectedBytes: item.length,
          sha256: item.sha256,
          fetch: options.fetch ?? fetchOfficialAsset,
          onBytes: (progress) => control?.update(progress),
        })
      await verify(item, download)
      if (control?.signal.aborted) throw control.signal.reason
      control?.update({ phase: 'install' })
      const staged = stagedFile(item)
      fs.mkdirSync(path.dirname(staged), { recursive: true })
      // The durable intent precedes every rename; recovery also accepts download/.
      state.save(item, 'installing')
      fs.renameSync(download, staged)
      await finishInstall(state, item)
      return { packageId: id, version, reused: false }
    } catch (error) {
      state.save(item, 'error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  return {
    check: () => locked(async () => selectUpdates(await source.refresh()).filter((item) => item.kind === 'translation-resource')),
    list: () =>
      locked(async (state) => {
        const active = resources.list()
        return state.list().map((record) => ({
          ...record,
          active: active.some((row) => row.packId === record.descriptor.resource?.packId && row.version === record.descriptor.resource?.version && row.active === 1),
        }))
      }),
    install(id: string, version: string, control?: DownloadJobControl) {
      safePackageId(id)
      packageVersion(version)
      return locked(async (state) => installFromCatalog(state, id, version, await source.refresh(), control))
    },
    async importOffline(input: string) {
      const bundle = parseOfflineUpdate(input)
      safePackageId(bundle.packageId)
      packageVersion(bundle.packageVersion)
      return locked(async (state) => installFromCatalog(state, bundle.packageId, bundle.packageVersion, await source.refresh(bundle.metadata), undefined, bundle.content))
    },
    activate(id: string, version: string, rollback = false) {
      safePackageId(id)
      packageVersion(version)
      return locked(async (state) => {
        const records = state.list().filter((row) => row.descriptor.packageId === id)
        const record = records.find((row) => row.descriptor.packageVersion === version)
        if (!record || record.phase !== 'installed') throw new Error('Version has not been installed successfully')
        const item = parseUpdatePackage(record.descriptor)
        assertCompatible(item)
        if (!rollback && records.some((row) => row.phase === 'installed' && comparePackageVersions(row.descriptor.packageVersion, version) > 0)) {
          throw new Error('Older installed version requires explicit local rollback')
        }
        await verify(item, installedFile(item))
        state.save(item, 'activating')
        try {
          await finishActivation(state, item, rollback ? 'local-rollback' : 'activated')
          return { packageId: id, version, nextBatch: true }
        } catch (error) {
          // Installation stays usable after a transient storage activation error.
          state.save(item, 'installed', error instanceof Error ? error.message : String(error))
          throw error
        }
      })
    },
  }
}

export const updateCoordinator = createUpdateCoordinator({
  directory: UPDATES_DIR,
  source: createTrustedSource(path.join(UPDATES_DIR, 'metadata'), path.join(ROOT_PATH, 'resources', 'updates', 'root.json')),
  resources: resourceUpdatePort,
})

export function startUpdateInstall(id: string, version: string) {
  safePackageId(id)
  packageVersion(version)
  return startDownloadJob('update-package', (control) => updateCoordinator.install(id, version, control), { dedupeKey: `${id}@${version}` })
}
