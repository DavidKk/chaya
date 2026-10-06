'use client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { formCard, panelHead, settingsCardNarrow } from '@/components/layoutClasses'
import { Select, Switch } from '@/components/sk'
import { COMPANION_CHARACTERS, type CompanionCharacter, companionWords } from '@/lib/game-agent/companion'

export type ToolPage = 'minimap' | 'companion'

const COPY = {
  zh: {
    minimap: '迷你地图',
    minimapDesc: '在地图详情中显示可移动的迷你地图。',
    companion: '陪玩 AI',
    companionDesc: '在游戏中显示陪玩角色的聊天与环境提示。',
    character: '助手',
    enabled: '开启',
    disabled: '关闭',
  },
  en: {
    minimap: 'Mini map',
    minimapDesc: 'Show the movable mini map in map details.',
    companion: 'Play companion',
    companionDesc: "Show the selected character's chat and game observations.",
    character: 'Companion',
    enabled: 'On',
    disabled: 'Off',
  },
  ja: {
    minimap: 'ミニマップ',
    minimapDesc: 'マップ詳細に移動できるミニマップを表示します。',
    companion: 'プレイ相棒 AI',
    companionDesc: 'ゲーム中に選択した相棒の会話と状況コメントを表示します。',
    character: '相棒',
    enabled: 'オン',
    disabled: 'オフ',
  },
  ko: {
    minimap: '미니맵',
    minimapDesc: '지도 상세에서 이동 가능한 미니맵을 표시합니다.',
    companion: '플레이 동행 AI',
    companionDesc: '게임에서 선택한 캐릭터의 대화와 상황 알림을 표시합니다.',
    character: '동행 캐릭터',
    enabled: '켜기',
    disabled: '끄기',
  },
} as const

export function ToolSettingsView({ page, request }: { page: ToolPage; request: GameAgentRequest }) {
  const locale = useLocaleCode()
  const copy = COPY[locale.slice(0, 2) as keyof typeof COPY] || COPY.en
  const { settings, busy, error, update } = useToolSettings(request)
  const isMap = page === 'minimap'
  const title = isMap ? copy.minimap : copy.companion
  const enabled = isMap ? settings.miniMapEnabled : settings.companionEnabled

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <h2 className="m-0 text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={settingsCardNarrow}>
          <section className={formCard}>
            <Switch
              checked={enabled}
              label={title}
              description={isMap ? copy.minimapDesc : copy.companionDesc}
              disabled={busy}
              toggleTooltip={`${enabled ? copy.disabled : copy.enabled} ${title}`}
              onCheckedChange={(next) => void update(isMap ? { miniMapEnabled: next } : { companionEnabled: next })}
            />
            {!isMap ? (
              <div className="flex min-w-0 items-center justify-between gap-4">
                <label htmlFor="companion-character" className="text-sm font-medium text-ink">
                  {copy.character}
                </label>
                <Select
                  id="companion-character"
                  className="w-48 max-w-[60%]"
                  value={settings.companionCharacter}
                  options={COMPANION_CHARACTERS.map((character) => ({ value: character, label: companionWords(locale).names[character] }))}
                  disabled={busy || !enabled}
                  onChange={(character) => void update({ companionCharacter: character as CompanionCharacter })}
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-fail">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
