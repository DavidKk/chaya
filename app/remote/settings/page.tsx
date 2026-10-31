'use client'

import React, { useEffect, useState } from "react"

import { useT } from "@/components/i18n/LocaleProvider"
import {
  formCard,
  formControlInline,
  formDescInline,
  formFieldInlineDense,
  formTitleInline,
  panelHead,
  settingsCardNarrow,
} from "@/components/layoutClasses"
import { NumberSliderInput, ScrollArea, Select } from "@/components/sk"
import { SwitchToggle } from "@/components/sk/Switch"
import { cn } from "@/lib/utils"

const SETTINGS_KEY = "chaya:cloud-game:settings"

interface CloudGameSettings {
  idleTimeoutSeconds: number
  defaultControllerMode: string
  targetFps: string
  muteHostAudio: boolean
}

const DEFAULT_SETTINGS: CloudGameSettings = {
  idleTimeoutSeconds: 300,
  defaultControllerMode: "free",
  targetFps: "60",
  muteHostAudio: true,
}

export default function RemoteSettingsPage() {
  const t = useT()
  const [settings, setSettings] = useState<CloudGameSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setSettings({
          idleTimeoutSeconds:
            typeof parsed.idleTimeoutSeconds === "number"
              ? parsed.idleTimeoutSeconds
              : Number(parsed.idleTimeout || 300),
          defaultControllerMode: parsed.defaultControllerMode || "free",
          targetFps: parsed.targetFps || "60",
          muteHostAudio: parsed.muteHostAudio !== undefined ? Boolean(parsed.muteHostAudio) : true,
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
  }

  const controllerOptions = [
    { value: "free", label: "自由摇杆" },
    { value: "fixed", label: "固定摇杆" },
    { value: "touch", label: "触屏点击" },
    { value: "single", label: "单手模式" },
  ]

  const fpsOptions = [
    { value: "60", label: "60 FPS (推荐)" },
    { value: "30", label: "30 FPS (省流)" },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper-2">
      {/* 头部布局与 assist/hotkeys 保持一致 */}
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t("nav.remoteSettings")}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">管理云游戏闲置清理策略与远程串流预设</p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" indicator="vertical">
        <div className="p-4 sm:p-5">
          <div className={settingsCardNarrow}>
            <section className={formCard}>
              {/* 闲置自动清理超时：参考 assist/saves 的 NumberSliderInput，全部右对齐 */}
              <label className={cn(formFieldInlineDense, "grid-cols-[minmax(0,1fr)_auto]")}>
                <span className={formTitleInline}>闲置自动清理超时</span>
                <span className={formDescInline}>
                  无连接时自动结束游戏进程释放硬件资源（设为 0 关闭自动清理）
                </span>
                <div className={formControlInline}>
                  <NumberSliderInput
                    className="w-36 min-w-[9rem]"
                    value={settings.idleTimeoutSeconds}
                    min={0}
                    max={3600}
                    step={30}
                    suffix={settings.idleTimeoutSeconds === 0 ? "关闭" : "秒"}
                    aria-label="闲置自动清理超时"
                    tooltip={
                      settings.idleTimeoutSeconds > 0
                        ? `约 ${(settings.idleTimeoutSeconds / 60).toFixed(1)} 分钟`
                        : "已关闭自动清理"
                    }
                    onValueChange={(val) => updateSetting("idleTimeoutSeconds", val)}
                  />
                </div>
              </label>

              {/* 移动端默认手柄模式：左右结构，右对齐 */}
              <label className={cn(formFieldInlineDense, "grid-cols-[minmax(0,1fr)_auto]")}>
                <span className={formTitleInline}>移动端默认操作模式</span>
                <span className={formDescInline}>新设备进入串流页面时的默认虚拟手柄模式</span>
                <div className={formControlInline}>
                  <Select
                    className="w-36"
                    value={settings.defaultControllerMode}
                    options={controllerOptions}
                    onChange={(val) => updateSetting("defaultControllerMode", val)}
                  />
                </div>
              </label>

              {/* 串流目标帧率：左右结构，右对齐 */}
              <label className={cn(formFieldInlineDense, "grid-cols-[minmax(0,1fr)_auto]")}>
                <span className={formTitleInline}>串流目标帧率</span>
                <span className={formDescInline}>WebRTC 画面编码与传输目标帧率</span>
                <div className={formControlInline}>
                  <Select
                    className="w-36"
                    value={settings.targetFps}
                    options={fpsOptions}
                    onChange={(val) => updateSetting("targetFps", val)}
                  />
                </div>
              </label>

              {/* 串流时静音主机扬声器：左右结构，右对齐 */}
              <div
                className={cn(formFieldInlineDense, "grid-cols-[minmax(0,1fr)_auto] cursor-pointer")}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest('[role="switch"], [role="checkbox"]')) return
                  updateSetting("muteHostAudio", !settings.muteHostAudio)
                }}
              >
                <span className={formTitleInline}>串流时静音主机扬声器</span>
                <span className={formDescInline}>声音仅通过 WebRTC 传输至客户端，主机物理扬声器保持静音</span>
                <div className={formControlInline}>
                  <SwitchToggle
                    checked={settings.muteHostAudio}
                    onCheckedChange={(checked) => updateSetting("muteHostAudio", checked)}
                    aria-label="串流时静音主机扬声器"
                    tooltip={settings.muteHostAudio ? "关闭主机静音" : "开启主机静音"}
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
