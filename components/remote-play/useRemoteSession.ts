'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'
import { WebGameLink } from '@/lib/runtime/web-game-link'

export type LibraryItem = {
  id: string
  name: string
  gameRoot: string
  remote?: boolean
  missing?: boolean
  kindLabel?: string
  fingerprint?: { engine?: { name?: string; version?: string } }
  running?: { mode: 'local' | 'cloud'; pid: number; roomId: string } | null
}

export type SessionPhase = 'select' | 'launching' | 'connecting' | 'reconnecting' | 'connected' | 'failed'
export const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2200
const CONNECTION_TIMEOUT_MS = 20_000

export function useRemoteSession(initialRoomId?: string) {
  const [roomId, setRoomId] = useState(initialRoomId || '')
  const [phase, setPhaseState] = useState<SessionPhase>('select')
  const [isSpectator, setIsSpectator] = useState(false)
  const [failureKind, setFailureKind] = useState<'launch' | 'connection'>('connection')
  const [retryCount, setRetryCount] = useState(0)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [videoFps, setVideoFps] = useState<number | null>(null)
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [selectedGame, setSelectedGame] = useState<LibraryItem | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<'launchFailed' | 'switchFailed' | 'quitFailed' | null>(null)
  const linkRef = useRef<WebGameLink | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const phaseRef = useRef<SessionPhase>('select')
  const generationRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const quittingRef = useRef(false)

  const setPhase = useCallback((next: SessionPhase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    if (deadlineRef.current) clearTimeout(deadlineRef.current)
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    retryTimerRef.current = null
    deadlineRef.current = null
    pollTimerRef.current = null
  }, [])

  const stop = useCallback(() => {
    generationRef.current += 1
    clearTimers()
    requestRef.current?.abort()
    requestRef.current = null
    const previous = linkRef.current
    linkRef.current = null
    previous?.stop({ silent: true })
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [clearTimers])

  const cancel = useCallback(() => {
    remotePlayLogger.info('User cancelled remote session; returning to game selection')
    stop()
    setIsSpectator(false)
    setRetryCount(0)
    setLatencyMs(null)
    setNotice(null)
    setPhase('select')
  }, [stop, setPhase])

  const connect = useCallback(
    function connectRoom(targetRoom: string, generation: number, retry = 0, forceRole?: 'controller' | 'spectator') {
      if (generation !== generationRef.current) return
      clearTimers()
      const previous = linkRef.current
      linkRef.current = null
      previous?.stop({ silent: true })
      setRetryCount(retry)
      setVideoFps(null)
      setPhase(retry ? 'reconnecting' : 'connecting')
      let handledFailure = false
      const isCurrent = () => generation === generationRef.current && linkRef.current === link

      const failAttempt = (reason: string) => {
        if (!isCurrent() || handledFailure) return
        handledFailure = true
        clearTimers()
        linkRef.current = null
        link.stop({ silent: true })
        streamRef.current = null
        if (videoRef.current) videoRef.current.srcObject = null
        setLatencyMs(null)
        remotePlayLogger.warn(`Remote stream attempt failed: ${reason}`, { retry, maxRetries: MAX_RETRIES })
        if (retry >= MAX_RETRIES) {
          setFailureKind('connection')
          setPhase('failed')
          return
        }
        setRetryCount(retry + 1)
        setPhase('reconnecting')
        retryTimerRef.current = setTimeout(() => connectRoom(targetRoom, generation, retry + 1, forceRole), RETRY_DELAY_MS)
      }

      const link = new WebGameLink(targetRoom, {
        onLog: (level, message, meta) => {
          if (isCurrent()) remotePlayLogger.add(level, message, meta)
        },
        onVideoStats: ({ framesPerSecond }) => {
          if (isCurrent() && !handledFailure) setVideoFps(framesPerSecond)
        },
        onConnected: () => {
          if (!isCurrent() || handledFailure) return
          clearTimers()
          retry = 0
          setRetryCount(0)
          setPhase('connected')
          remotePlayLogger.ok(`Remote stream connected (${link.isSpectator ? 'spectator' : 'controller'})`)
        },
        onDisconnected: () => failAttempt('Transport disconnected'),
        onIdle: () => failAttempt('Signaling timed out'),
        onTrack: (stream) => {
          if (!isCurrent() || handledFailure) return
          streamRef.current = stream
          if (!videoRef.current) return
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => remotePlayLogger.warn('Video autoplay requires a user gesture'))
        },
        onMessage: (message) => {
          if (!isCurrent()) return
          if (message.type === 'pong') setLatencyMs(Math.max(1, Math.round((Date.now() - message.t) / 2)))
          if (message.type === 'hello') {
            if ((message as any).spectator || (message as any).isController === false) {
              setIsSpectator(true)
            }
          }
        },
      })
      linkRef.current = link
      deadlineRef.current = setTimeout(() => failAttempt('Connection deadline exceeded'), CONNECTION_TIMEOUT_MS)

      void (async () => {
        try {
          let asSpectator = forceRole === 'spectator' ? true : forceRole === 'controller' ? false : null
          if (asSpectator === null) {
            const res = await fetch(`/api/runtime/webrtc?roomId=${encodeURIComponent(targetRoom)}`).catch(() => null)
            const data = res && res.ok ? await res.json().catch(() => null) : null
            const existingRoom = data?.room
            const hasActiveController = Boolean(existingRoom?.webConnected && Date.now() - (existingRoom.updatedAt || 0) < 35_000)
            asSpectator = hasActiveController
          }
          if (!isCurrent()) return
          setIsSpectator(asSpectator)
          remotePlayLogger.info('Connecting remote stream', { roomId: targetRoom, retry, role: asSpectator ? 'spectator' : 'controller' })
          await link.start({ enableMedia: true, takeover: !asSpectator, role: asSpectator ? 'spectator' : 'controller' })
        } catch (error: unknown) {
          failAttempt(error instanceof Error ? error.message : String(error))
        }
      })()
    },
    [clearTimers, setPhase]
  )

  useEffect(() => {
    const controller = new AbortController()
    const generation = generationRef.current
    setReady(false)
    void fetch('/api/status?scope=play', { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Game status request failed: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        const games: LibraryItem[] = (data.library || []).filter((item: LibraryItem) => !item.remote && !item.missing)
        const current =
          games.find((item) => item.id === initialRoomId || item.running?.roomId === initialRoomId) || games.find((item) => item.gameRoot === data.selected) || games[0] || null
        setLibrary(games)
        setSelectedGame(current)
        setRoomId(current?.id || initialRoomId || '')
        setReady(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        remotePlayLogger.fail(`Failed to load game library: ${String(error)}`)
        setNotice('launchFailed')
        setReady(true)
      })
    return () => {
      controller.abort()
      stop()
    }
  }, [initialRoomId, stop])

  const refreshGames = useCallback(async () => {
    const generation = generationRef.current
    try {
      const res = await fetch('/api/status?scope=play', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Game list request failed: ${res.status}`)
      const data = await res.json()
      if (generation !== generationRef.current) return
      const games: LibraryItem[] = (data.library || []).filter((item: LibraryItem) => !item.remote && !item.missing)
      setLibrary(games)
      setSelectedGame((current) => games.find((game) => game.id === current?.id) || null)
    } catch (error) {
      remotePlayLogger.warn(`Failed to refresh playable games: ${String(error)}`)
    }
  }, [])

  useEffect(() => {
    const ping = setInterval(() => {
      if (linkRef.current?.connected) linkRef.current.send({ type: 'ping', t: Date.now() })
    }, 2500)
    return () => clearInterval(ping)
  }, [])

  const launch = useCallback(async () => {
    if (!roomId || !selectedGame || quittingRef.current || !['select', 'failed'].includes(phaseRef.current)) return
    stop()
    const generation = generationRef.current
    const controller = new AbortController()
    requestRef.current = controller
    const active = () => generation === generationRef.current && !controller.signal.aborted
    setNotice(null)
    setRetryCount(0)
    setPhase(selectedGame.running ? 'connecting' : 'launching')
    remotePlayLogger.info('User requested remote game launch using host settings', { roomId })

    const failLaunch = (error: unknown) => {
      if (!active()) return
      clearTimers()
      controller.abort()
      setFailureKind('launch')
      setPhase('failed')
      remotePlayLogger.fail(`Game launch failed: ${String(error)}`)
    }

    deadlineRef.current = setTimeout(() => failLaunch('Game launch deadline exceeded'), 40_000)
    try {
      // Revalidate before choosing between joining an existing process and launching.
      const snapshot = await fetch('/api/status?scope=play', { cache: 'no-store', signal: controller.signal })
      if (!active()) return
      if (!snapshot.ok) throw new Error(`Game list request failed: ${snapshot.status}`)
      const current = await snapshot.json()
      if (!active()) return
      const games: LibraryItem[] = (current.library || []).filter((game: LibraryItem) => !game.remote && !game.missing)
      const target = games.find((game) => game.id === selectedGame.id)
      if (!target) throw new Error('Selected game is no longer available')
      setLibrary(games)
      setSelectedGame(target)
      if (target.running) {
        remotePlayLogger.info('Joining an existing game without relaunching', { roomId: target.running.roomId, mode: target.running.mode })
        setRoomId(target.running.roomId)
        connect(target.running.roomId, generation)
        return
      }
      const targetRoom = target.id
      setRoomId(targetRoom)
      setPhase('launching')
      // The URL may target a different library entry than the host's current selection.
      const selection = await fetch('/api/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameRoot: target.gameRoot }),
        signal: controller.signal,
      })
      if (!active()) return
      if (!selection.ok) throw new Error(`Game selection request failed: ${selection.status}`)
      const res = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remotePlay: true }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!active()) return
      if (!res.ok || data.ok === false) throw new Error(data.error?.message || data.error || 'Launch request failed')
      if (data.alreadyRunning) {
        const runningRoom = data.roomId || targetRoom
        setRoomId(runningRoom)
        connect(runningRoom, generation)
        return
      }

      const poll = async (attempt: number) => {
        if (!active()) return
        try {
          const response = await fetch(`/api/status?gameId=${encodeURIComponent(targetRoom)}`, { signal: controller.signal })
          const status = await response.json()
          if (!active()) return
          if (response.ok && status.runtime?.gameOnline) {
            clearTimers()
            connect(targetRoom, generation)
            return
          }
        } catch (error) {
          if (!active()) return
          remotePlayLogger.warn(`Game readiness probe failed: ${String(error)}`)
        }
        if (attempt >= 30) {
          failLaunch('Timed out waiting for game process')
        } else {
          pollTimerRef.current = setTimeout(() => void poll(attempt + 1), 1200)
        }
      }
      void poll(1)
    } catch (error) {
      failLaunch(error)
    }
  }, [roomId, selectedGame, stop, setPhase, connect, clearTimers])

  const reconnect = useCallback(() => {
    if (phaseRef.current !== 'failed') return
    if (failureKind === 'launch') {
      void launch()
      return
    }
    stop()
    setNotice(null)
    connect(roomId, generationRef.current)
  }, [failureKind, launch, stop, connect, roomId])

  const selectGame = useCallback(
    async (game: LibraryItem) => {
      if (quittingRef.current) return false
      cancel()
      // Browsing the launcher must not change the host binding or terminate a game.
      setSelectedGame(game)
      setRoomId(game.id)
      return true
    },
    [cancel]
  )

  const quit = useCallback(async () => {
    if (quittingRef.current) return false
    quittingRef.current = true
    linkRef.current?.send({ type: 'quit' })
    cancel()
    setSelecting(true)
    try {
      const res = await fetch('/api/launch', { method: 'DELETE' })
      if (!res.ok) throw new Error(`Game quit request failed: ${res.status}`)
      setLibrary((games) => games.map((game) => ({ ...game, running: null })))
      setSelectedGame((game) => (game ? { ...game, running: null } : null))
      return true
    } catch (error) {
      remotePlayLogger.fail(`Failed to quit game: ${String(error)}`)
      setNotice('quitFailed')
      return false
    } finally {
      quittingRef.current = false
      setSelecting(false)
    }
  }, [cancel])

  // Resume playback without creating extra connection attempts on focus/pageshow.
  const resume = useCallback(() => {
    if (phaseRef.current !== 'connected') return
    const video = videoRef.current
    if (video) {
      if (streamRef.current && video.srcObject !== streamRef.current) video.srcObject = streamRef.current
      if (video.paused) void video.play().catch(() => remotePlayLogger.warn('Video resume requires a user gesture'))
    }
    if (linkRef.current?.connected) {
      linkRef.current.send({ type: 'stream.request_keyframe' })
      linkRef.current.send({ type: 'ping', t: Date.now() })
    }
  }, [])

  const claimControl = useCallback(() => {
    if (!roomId) return
    stop()
    setNotice(null)
    setIsSpectator(false)
    connect(roomId, generationRef.current, 0, 'controller')
  }, [roomId, stop, connect])

  const status: 'connected' | 'connecting' | 'disconnected' =
    phase === 'connected' ? 'connected' : phase === 'connecting' || phase === 'reconnecting' ? 'connecting' : 'disconnected'
  return {
    roomId,
    phase,
    status,
    isSpectator,
    claimControl,
    failureKind,
    retryCount,
    latencyMs,
    videoFps,
    library,
    selectedGame,
    ready,
    selecting,
    notice,
    linkRef,
    videoRef,
    streamRef,
    launch,
    cancel,
    reconnect,
    selectGame,
    refreshGames,
    quit,
    resume,
  }
}
