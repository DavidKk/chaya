import fs from 'node:fs'
import path from 'node:path'

import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { agentEntryId, isBuiltinEngineId, TRANSLATE_ENGINE_IDS, type TranslateEngineId } from '@/lib/translate/engines'
import { DEFAULT_SILENT_TRANSLATE_CONFIG, type SilentTranslateConfig } from '@/lib/translate/silent'
import { appendLog } from '@/services/log'

import { getTranslateEngineSwitches, setTranslateEngineSwitches } from './engine-switches'
import { startSeedJob } from './seed-job'
import { idleSeedJob, readSeedJobState, writeSeedJobState } from './seed-job-state'

export { DEFAULT_SILENT_TRANSLATE_CONFIG, type SilentTranslateConfig }

function silentConfigFile(): string {
  return path.join(toolkitDataDir(), 'translate', 'silent-translate.json')
}

export function getSilentTranslateConfig(): SilentTranslateConfig {
  const file = silentConfigFile()
  if (!fs.existsSync(file)) return { ...DEFAULT_SILENT_TRANSLATE_CONFIG }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SilentTranslateConfig>
    return {
      enabled: raw.enabled === true,
      engine: typeof raw.engine === 'string' && raw.engine.trim() ? raw.engine.trim() : 'default',
    }
  } catch {
    return { ...DEFAULT_SILENT_TRANSLATE_CONFIG }
  }
}

export function setSilentTranslateConfig(patch: Partial<SilentTranslateConfig>): SilentTranslateConfig {
  const current = getSilentTranslateConfig()
  const next: SilentTranslateConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    engine: typeof patch.engine === 'string' && patch.engine.trim() ? patch.engine.trim() : current.engine,
  }
  const file = silentConfigFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/**
 * Trigger background extraction and translation if silent translation is enabled.
 * Executes asynchronously on next tick without blocking the caller.
 */
export function triggerSilentTranslateIfEnabled(contentRoot: string, opts?: { gameId?: string }): void {
  const config = getSilentTranslateConfig()
  if (!config.enabled || !contentRoot) return

  setImmediate(() => {
    void runSilentExtractionAndTranslation(contentRoot, config, opts)
  })
}

export async function runSilentExtractionAndTranslation(
  contentRoot: string,
  config: SilentTranslateConfig = getSilentTranslateConfig(),
  opts?: { gameId?: string }
): Promise<void> {
  const state = readSeedJobState(contentRoot) ?? idleSeedJob(contentRoot)
  state.status = 'running'
  state.inventoryPreparing = true
  state.liveStatus = '正在静默抽取游戏文本…'
  state.updatedAt = Date.now()
  try {
    writeSeedJobState(state)
  } catch {
    /* ignore snapshot write errors */
  }

  appendLog({
    level: 'info',
    source: 'translate',
    message: `[SilentTranslate] Extracting multilingual text for ${contentRoot}`,
  })

  try {
    const { extractAndEnsureSeed } = await import('@/services/extract/ensure-seed')
    const extractResult = extractAndEnsureSeed({ contentRoot, gameId: opts?.gameId })
    appendLog({
      level: 'info',
      source: 'translate',
      message: `[SilentTranslate] Text extracted: ${extractResult.unique} unique, ${extractResult.added} added`,
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    appendLog({
      level: 'error',
      source: 'translate',
      message: `[SilentTranslate] Extraction failed: ${errMsg}`,
    })
    const failed = readSeedJobState(contentRoot) ?? idleSeedJob(contentRoot)
    failed.status = 'error'
    failed.inventoryPreparing = false
    failed.error = `静默抽取文本失败: ${errMsg}`
    failed.liveStatus = ''
    failed.updatedAt = Date.now()
    try {
      writeSeedJobState(failed)
    } catch {
      /* ignore */
    }
    return
  }

  let jobEngines: string[] | undefined
  if (config.engine && config.engine !== 'default') {
    jobEngines = [config.engine]
    try {
      const currentSwitches = getTranslateEngineSwitches(contentRoot)
      const isBuiltin = isBuiltinEngineId(config.engine)
      const nextSwitches = { ...currentSwitches.switches }
      if (isBuiltin) {
        for (const id of TRANSLATE_ENGINE_IDS) {
          nextSwitches[id] = id === config.engine
        }
      }
      let nextAgents = currentSwitches.agents
      if (!isBuiltin) {
        const id = agentEntryId(config.engine)
        if (id) {
          nextAgents = currentSwitches.agents.map((a) => (a.id === id ? { ...a, enabled: true } : a))
        }
      }
      const otherEngines = currentSwitches.order.filter((e) => e !== config.engine)
      const nextOrder = [config.engine as TranslateEngineId, ...otherEngines]
      setTranslateEngineSwitches(
        {
          switches: nextSwitches,
          order: nextOrder,
          agents: nextAgents,
        },
        contentRoot
      )
    } catch {
      /* proceed with translation even if updating switches throws */
    }
  }

  appendLog({
    level: 'info',
    source: 'translate',
    message: `[SilentTranslate] Starting translation job with engine: ${config.engine === 'default' ? 'default' : config.engine}`,
  })

  try {
    startSeedJob({ contentRoot, gameId: opts?.gameId, engines: jobEngines })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    appendLog({
      level: 'error',
      source: 'translate',
      message: `[SilentTranslate] Failed to start translation: ${errMsg}`,
    })
    const failed = readSeedJobState(contentRoot) ?? idleSeedJob(contentRoot)
    failed.status = 'error'
    failed.inventoryPreparing = false
    failed.error = `静默翻译启动失败: ${errMsg}`
    failed.liveStatus = ''
    failed.updatedAt = Date.now()
    try {
      writeSeedJobState(failed)
    } catch {
      /* ignore */
    }
  }
}
