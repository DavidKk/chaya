'use client'

import { Menu } from '@base-ui/react/menu'
import { IoChevronDownOutline, IoLinkOutline } from 'react-icons/io5'
import { RiSparklingLine } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { dropdownItemClass, dropdownPopupClass } from '@/components/sk/dropdownMenu'

export function TranslateOptimizeMenu(props: { disabled: boolean; optimizingNames: boolean; syncingNames: boolean; onOptimizeNames: () => void; onSyncNames: () => void }) {
  const t = useT()
  const running = props.optimizingNames || props.syncingNames

  return (
    <Menu.Root>
      <Menu.Trigger disabled={props.disabled} render={<Button variant="ghost" loading={running} aria-label={t('translate.optimizeMenu')} />}>
        <RiSparklingLine size={16} aria-hidden />
        {t('translate.optimizeMenu')}
        <IoChevronDownOutline size={12} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} positionMethod="fixed" className="z-[70]">
          <Menu.Popup aria-label={t('translate.optimizeMenu')} className={dropdownPopupClass}>
            <Menu.Item className={dropdownItemClass} disabled={props.optimizingNames} onClick={props.onOptimizeNames}>
              <span className="inline-flex items-center gap-2">
                <RiSparklingLine size={15} aria-hidden />
                {t('translate.optimizeNames')}
              </span>
            </Menu.Item>
            <Menu.Item className={dropdownItemClass} disabled={props.syncingNames} onClick={props.onSyncNames}>
              <span className="inline-flex items-center gap-2">
                <IoLinkOutline size={15} aria-hidden />
                {t('translate.syncNames')}
              </span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
