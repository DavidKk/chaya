'use client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { formCard, panelHead, settingsCardNarrow } from '@/components/layoutClasses'
import { Select, Skeleton, SkeletonRegion, Switch } from '@/components/sk'
import { COMPANION_CHARACTERS, type CompanionCharacter, companionWords } from '@/lib/game-agent/companion'
export type ToolPage = 'minimap' | 'companion'

const COPY = {
  zh: {
    minimap: '迷你地图',
    minimapDesc: '在地图详情中显示可移动的迷你地图。',
    minimapPage: '在游戏中查看当前地图全貌和角色位置',
    companion: '陪玩 AI',
    companionDesc: '在游戏中显示陪玩角色的聊天与环境提示。',
    companionPage: '选择陪玩角色，边玩边聊并提示游戏中的情况',
    character: '助手',
    enabled: '开启',
    disabled: '关闭',
  },
  en: {
    minimap: 'Mini map',
    minimapDesc: 'Show the movable mini map in map details.',
    minimapPage: 'See the whole current map and where you are while playing',
    companion: 'Play companion',
    companionDesc: "Show the selected character's chat and game observations.",
    companionPage: 'Pick a companion who chats with you and comments on the game as you play',
    character: 'Companion',
    enabled: 'On',
    disabled: 'Off',
  },
  ja: {
    minimap: 'ミニマップ',
    minimapDesc: 'マップ詳細に移動できるミニマップを表示します。',
    minimapPage: 'プレイ中に現在のマップ全体と自分の位置を確認できます',
    companion: 'プレイ相棒 AI',
    companionDesc: 'ゲーム中に選択した相棒の会話と状況コメントを表示します。',
    companionPage: '相棒を選ぶと、プレイしながら会話や状況コメントを届けます',
    character: '相棒',
    enabled: 'オン',
    disabled: 'オフ',
  },
  ko: {
    minimap: '미니맵',
    minimapDesc: '지도 상세에서 이동 가능한 미니맵을 표시합니다.',
    minimapPage: '플레이 중 현재 지도 전체와 내 위치를 확인합니다',
    companion: '플레이 동행 AI',
    companionDesc: '게임에서 선택한 캐릭터의 대화와 상황 알림을 표시합니다.',
    companionPage: '동행 캐릭터를 고르면 플레이하며 대화하고 상황을 알려 줍니다',
    character: '동행 캐릭터',
    enabled: '켜기',
    disabled: '끄기',
  },
} as const

function ToolSettingsSkeleton({ label, withSelect }: { label: string; withSelect: boolean }) {
  return (
    <SkeletonRegion label={label} className={formCard}>
      <div className="flex items-center justify-between gap-4">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      {withSelect ? (
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-8 w-48 max-w-[60%]" />
        </div>
      ) : null}
    </SkeletonRegion>
  )
}

export function ToolSettingsView({ page, request }: { page: ToolPage; request: GameAgentRequest }) {
  const locale = useLocaleCode()
  const copy = COPY[locale.slice(0, 2) as keyof typeof COPY] || COPY.en
  const { settings, busy, loaded, error, update } = useToolSettings(request)
  const isMap = page === 'minimap'
  const title = isMap ? copy.minimap : copy.companion
  const enabled = isMap ? settings.miniMapEnabled : settings.companionEnabled

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-sm font-semibold text-ink">{title}</h2>
          <p className="m-0 truncate text-xs text-ink-soft">{isMap ? copy.minimapPage : copy.companionPage}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={settingsCardNarrow}>
          {!loaded ? (
            <ToolSettingsSkeleton label={title} withSelect={!isMap} />
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}
