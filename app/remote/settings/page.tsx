'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, formControlInline, formDescInline, formFieldInlineDense, formTitleInline, panelHead, settingsCardNarrow } from '@/components/layoutClasses'
import { Button, NumberSliderInput, ScrollArea, Select } from '@/components/sk'
import { SwitchToggle } from '@/components/sk/Switch'
import { DEFAULT_REMOTE_PLAY_HOST_SETTINGS, parseRemotePlayHostSettings, type RemotePlayHostSettings } from '@/lib/runtime/remote-play-settings'
import { cn } from '@/lib/utils'

const SETTINGS_KEY = 'chaya:cloud-game:settings'
const settingDescription = cn(formDescInline, 'min-w-0 whitespace-normal break-words')

interface CloudGameSettings {
  idleTimeoutSeconds: number
  defaultControllerMode: string
  targetFps: string
}

const DEFAULT_SETTINGS: CloudGameSettings = {
  idleTimeoutSeconds: 300,
  defaultControllerMode: 'free',
  targetFps: '60',
}

export default function RemoteSettingsPage() {
  const t = useT()
  const [settings, setSettings] = useState<CloudGameSettings>(DEFAULT_SETTINGS)
  const [hostSettings, setHostSettings] = useState<RemotePlayHostSettings>({ ...DEFAULT_REMOTE_PLAY_HOST_SETTINGS })
  const [hostReady, setHostReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hostError, setHostError] = useState<'loadFailed' | 'saveFailed' | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(false)

  const loadHostSettings = useCallback(async (signal?: AbortSignal) => {
    setHostReady(false)
    setHostError(null)
    try {
      const response = await fetch('/api/remote/settings', { cache: 'no-store', signal })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error('Host settings request failed')
      const next = parseRemotePlayHostSettings(data.settings)
      if (!mountedRef.current || signal?.aborted) return
      setHostSettings(next)
      if (typeof next.idleTimeoutSeconds === 'number') {
        setSettings((prev) => ({ ...prev, idleTimeoutSeconds: next.idleTimeoutSeconds! }))
      }
      setHostReady(true)
    } catch {
      if (mountedRef.current && !signal?.aborted) setHostError('loadFailed')
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()
    void loadHostSettings(controller.signal)
    return () => {
      mountedRef.current = false
      controller.abort()
    }
  }, [loadHostSettings])

  const updateHostSetting = async <K extends keyof RemotePlayHostSettings>(key: K, value: RemotePlayHostSettings[K]) => {
    if (!hostReady || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setHostError(null)
    try {
      const response = await fetch('/api/remote/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [key]: value } }),
      })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error('Host settings update failed')
      const next = parseRemotePlayHostSettings(data.settings)
      if (mountedRef.current) setHostSettings(next)
    } catch {
      if (mountedRef.current) setHostError('saveFailed')
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setSettings({
          idleTimeoutSeconds: typeof parsed.idleTimeoutSeconds === 'number' ? parsed.idleTimeoutSeconds : Number(parsed.idleTimeout || 300),
          defaultControllerMode: parsed.defaultControllerMode || 'free',
          targetFps: parsed.targetFps || '60',
        })
      }
    } catch {
      /* ignore */
    }
  }, [])

  const updateSetting = <K extends keyof CloudGameSettings>(key: K, val: CloudGameSettings[K]) => {
    const next = { ...settings, [key]: val }
    setSettings(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    if (key === 'idleTimeoutSeconds' && typeof val === 'number') {
      void updateHostSetting('idleTimeoutSeconds', val)
    }
  }

  const launchModeOptions = [
    { value: 'windowed', label: t('play.hostSettings.windowed') },
    { value: 'silent', label: t('play.hostSettings.silent') },
  ]

  const controllerOptions = [
    { value: 'free', label: '自由摇杆' },
    { value: 'fixed', label: '固定摇杆' },
    { value: 'touch', label: '触屏点击' },
    { value: 'single', label: '单手模式' },
  ]

  const fpsOptions = [
    { value: '60', label: '60 FPS' },
    { value: '30', label: '30 FPS' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper-2">
      {/* Match the standard management page header. */}
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t('nav.remoteSettings')}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">管理云游戏闲置清理策略与远程串流预设</p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" indicator="vertical">
        <div className="p-4 sm:p-5">
          <div className={settingsCardNarrow}>
            {hostError && (
              <div role="alert" className="mb-3 flex items-center justify-between gap-3 text-xs text-fail">
                <span>{t(`play.hostSettings.${hostError}`)}</span>
                {hostError === 'loadFailed' && <Button onClick={() => void loadHostSettings()}>{t('common.retry')}</Button>}
              </div>
            )}
            <section className={formCard}>
              <label className={cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto]')}>
                <span className={formTitleInline}>{t('play.hostSettings.launchMode')}</span>
                <span className={settingDescription}>{t('play.hostSettings.launchModeDesc')}</span>
                <div className={formControlInline}>
                  <Select
                    className="w-36 max-w-full"
                    value={hostSettings.launchMode}
                    options={launchModeOptions}
                    disabled={!hostReady || saving}
                    loading={!hostReady && !hostError}
                    aria-label={t('play.hostSettings.launchMode')}
                    onChange={(val) => void updateHostSetting('launchMode', val as RemotePlayHostSettings['launchMode'])}
                  />
                </div>
              </label>

              {/* Keep numeric controls aligned with the other settings rows. */}
              <label className={cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto]')}>
                <span className={formTitleInline}>闲置自动清理超时</span>
                <span className={settingDescription}>无连接时自动结束游戏进程释放硬件资源（设为 0 关闭自动清理）</span>
                <div className={formControlInline}>
                  <NumberSliderInput
                    className="w-36 min-w-[9rem]"
                    value={settings.idleTimeoutSeconds}
                    min={0}
                    max={3600}
                    step={30}
                    suffix={settings.idleTimeoutSeconds === 0 ? '关闭' : '秒'}
                    aria-label="闲置自动清理超时"
                    tooltip={settings.idleTimeoutSeconds > 0 ? `约 ${(settings.idleTimeoutSeconds / 60).toFixed(1)} 分钟` : '已关闭自动清理'}
                    onValueChange={(val) => updateSetting('idleTimeoutSeconds', val)}
                  />
                </div>
              </label>

              <label className={cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto]')}>
                <span className={formTitleInline}>移动端默认操作模式</span>
                <span className={settingDescription}>新设备进入串流页面时的默认虚拟手柄模式</span>
                <div className={formControlInline}>
                  <Select className="w-36" value={settings.defaultControllerMode} options={controllerOptions} onChange={(val) => updateSetting('defaultControllerMode', val)} />
                </div>
              </label>

              <label className={cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto]')}>
                <span className={formTitleInline}>串流目标帧率</span>
                <span className={settingDescription}>{t('play.hostSettings.targetFpsDesc')}</span>
                <div className={formControlInline}>
                  <Select className="w-36" value={settings.targetFps} options={fpsOptions} onChange={(val) => updateSetting('targetFps', val)} />
                </div>
              </label>

              <div
                className={cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto] cursor-pointer')}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest('[role="switch"], [role="checkbox"]')) return
                  void updateHostSetting('muteHostAudio', !hostSettings.muteHostAudio)
                }}
              >
                <span className={formTitleInline}>{t('play.hostSettings.mute')}</span>
                <span className={settingDescription}>
                  {t('play.hostSettings.muteDesc')} {t('play.hostSettings.audioNotice')}
                </span>
                <div className={formControlInline}>
                  <SwitchToggle
                    checked={hostSettings.muteHostAudio}
                    disabled={!hostReady || saving}
                    onCheckedChange={(checked) => void updateHostSetting('muteHostAudio', checked)}
                    aria-label={t('play.hostSettings.mute')}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
