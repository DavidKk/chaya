'use client'

import { type ReactNode, Suspense } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { GameLinkProvider } from '@/components/GameLinkProvider'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NavigationRestoration } from '@/components/navigation/NavigationRestoration'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { ChayaWebMcpHost } from '@/components/webmcp/ChayaWebMcpHost'
import type { Locale, LocalePreference } from '@/lib/i18n'

export function AppProviders({ children, locale, preference }: { children: ReactNode; locale: Locale; preference: LocalePreference }) {
  return (
    <LocaleProvider initialLocale={locale} initialPreference={preference}>
      <NotificationProvider>
        <ConfirmProvider>
          <GameLinkProvider>
            <ChayaWebMcpHost />
            <Suspense fallback={null}>
              <NavigationRestoration />
            </Suspense>
            {children}
          </GameLinkProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </LocaleProvider>
  )
}
