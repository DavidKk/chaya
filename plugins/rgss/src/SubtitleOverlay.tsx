import { useEffect, useRef, useState } from 'react'

import { onGameMessage, postToGame } from './host-bridge'

function readQueryParam(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  try {
    const config = (window as Window & { __CHAYA_RGSS_CONFIG__?: Record<string, string> }).__CHAYA_RGSS_CONFIG__
    if (config?.[key]) return config[key]
    const params = new URLSearchParams(window.location.search)
    return params.get(key) || fallback
  } catch {
    return fallback
  }
}

export function SubtitleOverlay() {
  const [dialogueKey, setDialogueKey] = useState<string | null>(null)
  const [mode, setMode] = useState<'realtime' | 'subtitle' | null>(null)
  const [translatedTexts, setTranslatedTexts] = useState<string[]>([])
  const [translatedChoices, setTranslatedChoices] = useState<string[]>([])
  const [pending, setPending] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = onGameMessage((msg) => {
      if (msg.type === 'translation.dialogue.close') {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        abortRef.current?.abort()
        abortRef.current = null
        currentKeyRef.current = null
        setDialogueKey(null)
        setMode(null)
        setTranslatedTexts([])
        setTranslatedChoices([])
        setPending(false)
        return
      }

      if (msg.type === 'translation.dialogue') {
        const { key, texts, choices = [], mode: dialMode, timeoutMs = 8000 } = msg
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        abortRef.current?.abort()
        const abort = new AbortController()
        abortRef.current = abort
        currentKeyRef.current = key

        setDialogueKey(key)
        setMode(dialMode)
        setTranslatedTexts([])
        setTranslatedChoices([])
        setPending(true)

        const apiBase = readQueryParam('apiBase', window.location.origin)
        const contentRoot = readQueryParam('contentRoot', '')
        const payloadTexts = [...texts, ...choices]

        timerRef.current = setTimeout(() => {
          abort.abort()
        }, timeoutMs)

        void (async () => {
          try {
            const response = await fetch(`${apiBase}/api/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: payloadTexts, persist: true, contentRoot }),
              signal: abort.signal,
            })
            if (timerRef.current) {
              clearTimeout(timerRef.current)
              timerRef.current = null
            }
            if (abort.signal.aborted || currentKeyRef.current !== key) return

            const data = (await response.json()) as { items?: Array<{ source: string; zh?: string }>; error?: { message?: string } }
            if (!response.ok) throw new Error(data?.error?.message || 'Translation failed')

            const items = data.items || []
            const results = items.map((item) => (item.zh && item.zh.trim() ? item.zh : item.source))
            const nextTexts = results.slice(0, texts.length)
            const nextChoices = results.slice(texts.length)

            setTranslatedTexts(nextTexts)
            setTranslatedChoices(nextChoices)
            setPending(false)

            if (dialMode === 'realtime') {
              postToGame({
                type: 'translation.dialogue.result',
                key,
                texts: nextTexts,
                choices: nextChoices,
              })
            }
          } catch {
            if (timerRef.current) {
              clearTimeout(timerRef.current)
              timerRef.current = null
            }
            if (!abort.signal.aborted && currentKeyRef.current === key) {
              setPending(false)
            }
          }
        })()
      }
    })

    return () => {
      unsubscribe()
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  if (!dialogueKey) return null

  if (mode === 'realtime' && pending) {
    return (
      <div data-realtime-pending="" className="pointer-events-none fixed right-4 bottom-4 z-40 select-none">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-xs text-sky-400 shadow">
          <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-r-transparent" />
          <span>翻译中...</span>
        </div>
      </div>
    )
  }

  if (mode === 'subtitle' && (translatedTexts.length > 0 || pending)) {
    return (
      <div data-subtitle-overlay="" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center justify-end px-4 select-none" aria-live="polite">
        <div className="flex max-w-2xl flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-black/80 px-4 py-2.5 shadow-xl backdrop-blur-sm">
          {pending && translatedTexts.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-sky-400">
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-r-transparent" />
              <span>翻译中...</span>
            </div>
          ) : (
            <>
              {translatedTexts.map((line, idx) => (
                <p key={idx} className="text-center text-sm md:text-base font-medium leading-relaxed text-white whitespace-pre-wrap">
                  {line}
                </p>
              ))}
              {translatedChoices.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-center gap-2 border-t border-white/10 pt-1.5">
                  {translatedChoices.map((choice, idx) => (
                    <span key={idx} className="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                      {idx + 1}. {choice}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return null
}
