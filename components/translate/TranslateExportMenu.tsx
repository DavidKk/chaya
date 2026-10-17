'use client'

import { Menu } from '@base-ui/react/menu'
import { IoChevronDownOutline, IoDownloadOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { dropdownItemClass, dropdownPopupClass } from '@/components/sk/dropdownMenu'
import type { TranslationExportMode } from '@/lib/translate/export'

export function TranslateExportMenu({ disabled, loading, onExport }: { disabled: boolean; loading: boolean; onExport: (mode: TranslationExportMode) => void }) {
  const t = useT()
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} render={<Button loading={loading} />}>
        <IoDownloadOutline size={16} aria-hidden />
        {t('translate.exportJson')}
        <IoChevronDownOutline size={12} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} positionMethod="fixed" className="z-[70]">
          <Menu.Popup aria-label={t('translate.exportJson')} className={dropdownPopupClass}>
            <Menu.Item className={dropdownItemClass} onClick={() => onExport('all')}>
              {t('translate.exportAll')}
            </Menu.Item>
            <Menu.Item className={dropdownItemClass} onClick={() => onExport('untranslated')}>
              {t('translate.exportUntranslated')}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
