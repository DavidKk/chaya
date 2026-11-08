import { CLI_AUTO_MODEL, cliModelChoices, isCliProvider } from '@/lib/game-agent/providers'

export type AgentModelChoice = { name: string; label?: string }

/** Empty / missing means “all discovered models are enabled”. */
export function normalizeEnabledModels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()))]
  return names
}

export function isModelEnabled(name: string, enabledModels: string[] | undefined): boolean {
  return !enabledModels || enabledModels.includes(name)
}

export function filterEnabledModels(catalog: readonly AgentModelChoice[], enabledModels: string[] | undefined): AgentModelChoice[] {
  if (!enabledModels) return [...catalog]
  if (!enabledModels.length) return []
  const byName = new Map(catalog.map((model) => [model.name, model]))
  return enabledModels.map((name) => byName.get(name) || { name })
}

/**
 * Resolve the model list companion / status UIs should show.
 * Prefer the allowlist when set; otherwise the live/cached catalog; otherwise the default model alone.
 */
export function resolveAgentProfileModels(
  profile: { provider?: string; defaultModel?: string; enabledModels?: string[] },
  cached: readonly AgentModelChoice[] = []
): { models: AgentModelChoice[]; defaultModel: string } {
  if (isCliProvider(profile.provider)) {
    return cliModelChoices(
      profile.defaultModel,
      filterEnabledModels(cached, profile.enabledModels).filter((model) => model.name !== CLI_AUTO_MODEL)
    )
  }

  // Allowlist is enough to offer choices even when the live catalog / disk cache is empty.
  const catalog = cached.length
    ? [...cached]
    : profile.enabledModels?.length
      ? profile.enabledModels.map((name) => ({ name }))
      : profile.defaultModel?.trim()
        ? [{ name: profile.defaultModel.trim() }]
        : []
  let models = filterEnabledModels(catalog, profile.enabledModels)
  const preferred = profile.defaultModel?.trim() || ''
  if (preferred && !models.some((model) => model.name === preferred)) {
    models = [...models, catalog.find((model) => model.name === preferred) || { name: preferred }]
  }
  const defaultModel = models.some((model) => model.name === preferred) ? preferred : models[0]?.name || ''
  return { models, defaultModel }
}

/** Sync / plugin payload: every profile’s companion-visible models (allowlist + cache). */
export function resolveAgentModelsByProfile(
  profiles: Array<{ id: string; provider?: string; defaultModel?: string; enabledModels?: string[] }>,
  cached: Record<string, readonly AgentModelChoice[]> = {}
): Record<string, AgentModelChoice[]> {
  return Object.fromEntries(
    profiles.flatMap((profile) => {
      const models = resolveAgentProfileModels(profile, cached[profile.id] || []).models
      return models.length ? [[profile.id, models] as const] : []
    })
  )
}
