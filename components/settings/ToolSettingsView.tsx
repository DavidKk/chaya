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
    companion: '旅伴',
    companionDesc: '在游戏中显示旅伴：陪你闲谈，也能替你打理游戏中的琐事。',
    companionPage: '选一位旅伴与你同行，陪你闲谈，也能替你打理游戏中的琐事',
    character: '角色',
    enabled: '开启',
    disabled: '关闭',
  },
  en: {
    minimap: 'Mini map',
    minimapDesc: 'Show the movable mini map in map details.',
    minimapPage: 'See the whole current map and where you are while playing',
    companion: 'Companion',
    companionDesc: 'Show your companion in game: someone to chat with, who can also handle chores for you.',
    companionPage: 'Pick a companion to travel with you, chat along the way, and handle chores in the game',
    character: 'Character',
    enabled: 'On',
    disabled: 'Off',
  },
  ja: {
    minimap: 'ミニマップ',
    minimapDesc: 'マップ詳細に移動できるミニマップを表示します。',
    minimapPage: 'プレイ中に現在のマップ全体と自分の位置を確認できます',
    companion: '旅の仲間',
    companionDesc: 'ゲーム中に旅の仲間を表示します。雑談の相手になり、ゲーム内の用事も任せられます。',
    companionPage: '共に旅する仲間を選びましょう。雑談の相手になり、ゲーム内の用事も任せられます',
    character: 'キャラクター',
    enabled: 'オン',
    disabled: 'オフ',
  },
  ko: {
    minimap: '미니맵',
    minimapDesc: '지도 상세에서 이동 가능한 미니맵을 표시합니다.',
    minimapPage: '플레이 중 현재 지도 전체와 내 위치를 확인합니다',
    companion: '길동무',
    companionDesc: '게임에서 길동무를 표시합니다. 이야기를 나누고 게임 속 잡일도 맡길 수 있어요.',
    companionPage: '함께 길을 걸을 길동무를 고르세요. 이야기를 나누고 게임 속 잡일도 맡길 수 있어요',
    character: '캐릭터',
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
