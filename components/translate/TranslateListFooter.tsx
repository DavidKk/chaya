'use client'

import type { FormEvent } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelFoot } from '@/components/layoutClasses'
import { Button, NumberInput, Select } from '@/components/sk'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 50

type Props = {
  translatedCount: number
  itemsCount: number
  rangeFrom: number
  rangeTo: number
  totalItems: number
  visiblePage: number
  totalPages: number
  pageSize: number
  jumpPageValue: number
  setJumpPageValue: (value: number) => void
  handleJumpSubmit: (event: FormEvent<HTMLFormElement>) => void
  updateQueryParams: (patch: Record<string, string | null | undefined>) => void
  go: (page: number) => void
}

/** Pagination + stats footer; narrow = first/prev/page/next (jump on commit). */
export function TranslateListFooter({
  translatedCount,
  itemsCount,
  rangeFrom,
  rangeTo,
  totalItems,
  visiblePage,
  totalPages,
  pageSize,
  jumpPageValue,
  setJumpPageValue,
  handleJumpSubmit,
  updateQueryParams,
  go,
}: Props) {
  const t = useT()
  return (
    <div className={`${panelFoot} max-md:justify-center`}>
      <div className="hidden md:flex items-center gap-1.5 text-xs select-none">
        <span className="font-medium text-ink">{t('translate.listStatsCount')}</span>
        <span className="font-mono font-semibold text-accent">{translatedCount.toLocaleString()}</span>
        <span className="font-mono text-ink-soft">/</span>
        <span className="font-mono text-ink">{itemsCount.toLocaleString()}</span>
        <span className="text-ink-soft text-[0.6875rem] ml-2">{t('translate.listPageRange', { from: rangeFrom, to: rangeTo, total: totalItems.toLocaleString() })}</span>
      </div>

      <div className="inline-flex items-center gap-1.5">
        <label className="mr-1 hidden md:inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem] text-ink-soft">
          <span>{t('translate.listPageSizeLabel')}</span>
          <Select
            className="w-[4.75rem]"
            aria-label={t('translate.listPageSizeAria')}
            tooltip={t('translate.listPageSizeTooltip')}
            value={String(pageSize)}
            panelWidth="content"
            options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => updateQueryParams({ pageSize: Number(v) === DEFAULT_PAGE_SIZE ? null : v, p: null })}
          />
        </label>

        <span className="mr-1 hidden md:inline tabular-nums text-ink">
          {visiblePage} / {totalPages}
        </span>

        <Button variant="ghost" size="icon" disabled={visiblePage <= 1} aria-label={t('translate.listPageFirst')} tooltip={t('translate.listPageFirst')} onClick={() => go(1)}>
          <IoPlaySkipBackOutline size={14} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={visiblePage <= 1}
          aria-label={t('translate.listPagePrev')}
          tooltip={t('translate.listPagePrev')}
          onClick={() => go(visiblePage - 1)}
        >
          <IoChevronBackOutline size={14} aria-hidden />
        </Button>

        {totalPages > 1 ? (
          <NumberInput
            min={1}
            max={totalPages}
            value={jumpPageValue}
            onValueChange={(val) => {
              setJumpPageValue(val)
              if (val >= 1 && val <= totalPages) go(val)
            }}
            className="!h-7 w-14 text-xs px-1 text-center font-sans md:hidden"
            aria-label={t('translate.listJumpPageAria')}
            tooltip={t('translate.listJumpPageTooltip')}
          />
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          disabled={visiblePage >= totalPages}
          aria-label={t('translate.listPageNext')}
          tooltip={t('translate.listPageNext')}
          onClick={() => go(visiblePage + 1)}
        >
          <IoChevronForwardOutline size={14} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          disabled={visiblePage >= totalPages}
          aria-label={t('translate.listPageLast')}
          tooltip={t('translate.listPageLast')}
          onClick={() => go(totalPages)}
        >
          <IoPlaySkipForwardOutline size={14} aria-hidden />
        </Button>

        {totalPages > 10 ? (
          <form onSubmit={handleJumpSubmit} className="hidden md:inline-flex items-center gap-1 shrink-0">
            <NumberInput
              min={1}
              max={totalPages}
              value={jumpPageValue}
              onValueChange={(val) => setJumpPageValue(val)}
              className="!h-7 w-16 text-xs px-1 text-center font-sans"
              aria-label={t('translate.listJumpPageAria')}
              tooltip={t('translate.listJumpPageTooltip')}
            />
            <Button type="submit" variant="default" className="!h-7 px-2.5 text-xs whitespace-nowrap shrink-0" tooltip={t('translate.listJumpPageTooltip')}>
              {t('translate.listJumpPageBtn')}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  )
}
