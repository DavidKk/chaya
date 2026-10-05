'use client'

import { useEffect, useState } from 'react'

import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'

export type TranslateAgentProfile = { id: string; label: string; defaultModel: string }

export type TranslateAgentProfiles = {
  loading: boolean
  error: string
  profiles: TranslateAgentProfile[]
  models: Record<string, Array<{ name: string }>>
}

/** 经翻译运行时读取 Agent 实例（页面与局内浮层同一路径；只含名称与模型） */
export function useTranslateAgentProfiles(): TranslateAgentProfiles {
  const translationFetch = useTranslationFetch()
  const [state, setState] = useState<TranslateAgentProfiles>({ loading: true, error: '', profiles: [], models: {} })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'agents' }),
        })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; profiles?: TranslateAgentProfile[]; models?: TranslateAgentProfiles['models'] } | null
        if (!res.ok || !body || body.ok === false || !Array.isArray(body.profiles)) throw new Error(readApiErrorMessage(body, `HTTP ${res.status}`))
        if (cancelled) return
        const profiles = body.profiles.map((p) => ({ id: p.id, label: p.label || p.id, defaultModel: p.defaultModel || '' }))
        setState({ loading: false, error: '', profiles, models: body.models || {} })
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err instanceof Error ? err.message : String(err), profiles: [], models: {} })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [translationFetch])

  return state
}
