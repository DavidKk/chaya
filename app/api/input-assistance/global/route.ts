import fs from 'node:fs'
import path from 'node:path'

import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { EMPTY_INPUT_ASSIST_CONFIG, type InputAssistConfig, parseInputAssistConfig, validateRule } from '@/lib/game/input-assistance'
import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { requireDisk } from '@/lib/service-mode'

export const runtime = 'nodejs'

function configFile(): string {
  return path.join(toolkitDataDir(), 'input-assistance', 'global.json')
}

function readConfig(): InputAssistConfig {
  let text: string
  try {
    text = fs.readFileSync(configFile(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_INPUT_ASSIST_CONFIG, rules: [] }
    throw error
  }
  const raw = JSON.parse(text)
  const config = parseInputAssistConfig(raw)
  if (raw?.version !== 1 || !Array.isArray(raw.rules) || config.rules.length !== raw.rules.length) throw new Error('通用辅助配置文件已损坏，请检查原文件')
  return config
}

export const GET = defineApiRoute('get:/api/input-assistance/global', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ config: readConfig() })
})

export const PUT = defineApiRoute('put:/api/input-assistance/global', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = await request.json().catch(() => null)
  const raw = body?.config
  const next = parseInputAssistConfig(raw)
  if (!raw || raw.version !== 1 || !Array.isArray(raw.rules) || raw.rules.length !== next.rules.length) return apiBadRequest('规则配置包含无效数据')
  for (const rule of next.rules) {
    const issue = validateRule(rule, false)[0]
    if (issue) return apiBadRequest(`${rule.name}: ${issue.message}`)
  }
  const current = readConfig()
  if (body.expectedRevision !== current.revision || next.revision !== current.revision + 1) return apiBadRequest('通用配置已在别处更改，请刷新后重试', 'REVISION_CONFLICT')
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2))
  fs.renameSync(temporary, file)
  return apiOk({ config: next })
})
