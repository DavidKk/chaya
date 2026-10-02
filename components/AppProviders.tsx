'use client'

import type { ReactNode } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { GameLinkProvider } from '@/components/GameLinkProvider'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { ChayaWebMcpHost } from '@/components/webmcp/ChayaWebMcpHost'
import type { Locale } from '@/lib/i18n'

export function AppProviders({ children, locale }: { children: ReactNode; locale: Locale }) {
  return (
    <LocaleProvider initialLocale={locale}>
      <NotificationProvider>
        <ConfirmProvider>
          <GameLinkProvider>
            <ChayaWebMcpHost />
            {children}
          </GameLinkProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </LocaleProvider>
  )
}
