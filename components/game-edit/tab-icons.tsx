'use client'

import type { IconType } from 'react-icons'
import {
  GiAbdominalArmor,
  GiAxeSword,
  GiBackpack,
  GiBurn,
  GiCrossedSwords,
  GiDatabase,
  GiNothingToSay,
  GiScrollUnfurled,
  GiSettingsKnobs,
  GiSlime,
  GiStrong,
  GiTreasureMap,
} from 'react-icons/gi'
import { HiVariable } from 'react-icons/hi'
import { IoIosSwitch } from 'react-icons/io'
import { IoListOutline, IoSettingsOutline } from 'react-icons/io5'
import { LuInfo, LuPlug } from 'react-icons/lu'

import type { TabId } from './tabs'

/** 修改二级导航图标 */
export const TAB_ICONS: Record<TabId, IconType> = {
  run: GiSettingsKnobs,
  bag: GiBackpack,
  item: GiBurn,
  weapon: GiAxeSword,
  armor: GiAbdominalArmor,
  var: HiVariable,
  sw: IoIosSwitch,
  actor: GiStrong,
  common: GiScrollUnfurled,
  map: GiTreasureMap,
  troop: GiSlime,
  battle: GiCrossedSwords,
  data: GiDatabase,
  trans: GiNothingToSay,
  logs: IoListOutline,
  mcp: LuPlug,
  settings: IoSettingsOutline,
  about: LuInfo,
}
