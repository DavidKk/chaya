/**
 * Cross-platform haptic feedback engine for Remote Play.
 *
 * Strategies:
 * 1. Standard W3C Vibration API (Android / Chrome / Edge / Opera).
 * 2. iOS 17.4+ WebKit Switch Taptic Engine (triggers system UISelectionFeedbackGenerator).
 * 3. Synthesized sub-bass 50Hz micro-impulse (displaces mobile speaker voice coil for physical palm bump).
 */

export type HapticType = 'light' | 'medium' | 'heavy' | 'selection'

class HapticEngine {
  private enabled: boolean = true
  private audioCtx: AudioContext | null = null
  private labelEl: HTMLElement | null = null

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('chaya_remote_haptic')
        if (stored !== null) {
          this.enabled = stored !== 'false'
        }
      } catch {
        /* ignore */
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public setEnabled(value: boolean) {
    this.enabled = value
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('chaya_remote_haptic', String(value))
      } catch {
        /* ignore */
      }
    }
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled)
    if (this.enabled) {
      this.trigger('medium')
    }
    return this.enabled
  }

  public trigger(type: HapticType = 'light') {
    if (!this.enabled || typeof window === 'undefined') return

    let didHardwareVibrate = false

    // 1. Hardware vibration API (Android / Chrome / Firefox)
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        const duration = type === 'selection' ? 8 : type === 'medium' ? 18 : type === 'heavy' ? 30 : 12
        didHardwareVibrate = navigator.vibrate(duration)
      }
    } catch {
      /* ignore */
    }

    // 2. iOS Safari WebKit Switch Hack (iOS 17.4+ Taptic Engine)
    try {
      if (!this.labelEl) {
        this.labelEl = document.getElementById('chaya-haptic-label')
      }
      if (this.labelEl) {
        this.labelEl.click()
      }
    } catch {
      /* ignore */
    }

    // 3. Sub-bass acoustic tactile impulse
    // When standard vibration is absent (iOS Safari), drive the loudspeaker voice coil with a 50Hz transient.
    if (!didHardwareVibrate) {
      this.playTactilePulse(type)
    }
  }

  private playTactilePulse(type: HapticType) {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx()
      }

      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume()
      }
      if (this.audioCtx.state !== 'running') return

      const ctx = this.audioCtx
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      // Low frequency sub-bass (50-60Hz) physically moves the phone's speaker cone
      const freq = type === 'selection' ? 62 : type === 'heavy' ? 45 : 52
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)

      const peakGain = type === 'selection' ? 0.08 : type === 'heavy' ? 0.28 : 0.16
      const duration = type === 'selection' ? 0.008 : type === 'heavy' ? 0.02 : 0.012

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + duration)
    } catch {
      /* ignore */
    }
  }
}

export const haptic = new HapticEngine()
