'use client'

import type { IconType } from 'react-icons'
import { GiAbdominalArmor, GiAxeSword, GiBackpack, GiBurn, GiCharacter, GiKey, GiNothingToSay, GiSettingsKnobs } from 'react-icons/gi'
import { HiVariable } from 'react-icons/hi'
import { IoIosSwitch } from 'react-icons/io'
import { IoListOutline } from 'react-icons/io5'
import { LuPlug } from 'react-icons/lu'

import type { TabId } from './tabs'

/** 修改二级导航图标；快捷键未指定专用图标时用 GiKey */
export const TAB_ICONS: Record<TabId, IconType> = {
  run: GiSettingsKnobs,
  bag: GiBackpack,
  item: GiBurn,
  weapon: GiAxeSword,
  armor: GiAbdominalArmor,
  var: HiVariable,
  sw: IoIosSwitch,
  actor: GiCharacter,
  trans: GiNothingToSay,
  logs: IoListOutline,
  hotkeys: GiKey,
  mcp: LuPlug,
}
