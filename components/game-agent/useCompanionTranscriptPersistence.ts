'use client'

import { useEffect, useRef, useState } from 'react'

import { type CompanionTranscript, loadCompanionTranscript, saveCompanionTranscript } from './companion-transcript'
import type { GameAgentRequest } from './GameAgentWorkspace'

/** Keep only a process-local view; acknowledged saves belong to the connected game service. */
export function useCompanionTranscriptPersistence(gameId: string, request: GameAgentRequest, transcript: CompanionTranscript, onLoad: (value: CompanionTranscript) => void) {
  const { messages, activity } = transcript
  const [loadedGame, setLoadedGame] = useState('')
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad
  const writes = useRef(Promise.resolve())
  const endpoint = `/api/game-agent/transcript?gameId=${encodeURIComponent(gameId)}`
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const response = await request(endpoint, { method: 'GET' })
        if (!response.ok) throw new Error('Transcript storage is unavailable')
        const body = (await response.json()) as { transcript?: CompanionTranscript }
        if (!active) return
        if (!body.transcript) {
          const legacy = loadCompanionTranscript(gameId, localStorage)
          if (legacy.messages.length || legacy.activity.length) {
            const saved = await request(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: legacy }) })
            if (!saved.ok) throw new Error('Legacy transcript import failed; source retained')
            body.transcript = legacy
          }
        }
        if (!active) return
        saveCompanionTranscript(gameId, body.transcript || { messages: [], activity: [] })
        onLoadRef.current(loadCompanionTranscript(gameId))
        setLoadedGame(gameId)
      } catch {
        if (active)
          timer = setTimeout(() => {
            void load()
          }, 3000)
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [endpoint, gameId, request])
  useEffect(() => {
    if (loadedGame !== gameId) return
    const snapshot = { messages, activity }
    saveCompanionTranscript(gameId, snapshot)
    const timer = setTimeout(() => {
      writes.current = writes.current
        .catch(() => undefined)
        .then(async () => {
          const response = await request(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: snapshot }) })
          if (!response.ok) throw new Error('Transcript save failed')
        })
      void writes.current.catch(() => undefined)
    }, 200)
    return () => clearTimeout(timer)
  }, [endpoint, gameId, loadedGame, request, messages, activity])
}
