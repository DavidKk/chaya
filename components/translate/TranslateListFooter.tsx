'use client'

import type { FormEvent } from 'react'
import { IoChevronBackOutline, IoChevronForwardOutline, IoPlaySkipBackOutline, IoPlaySkipForwardOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelFoot } from '@/components/layoutClasses'
import { Button, NumberInput, Select, Spinner } from '@/components/sk'

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
  savingPage: boolean
  resettingPage: boolean
  hasItems: boolean
  handleResetPage: () => Promise<void>
  handleSavePage: () => Promise<void>
}

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
  savingPage,
  resettingPage,
  hasItems,
  handleResetPage,
  handleSavePage,
}: Props) {
  const t = useT()
  return (
    <div className={panelFoot}>
      {/* Left: Translation counts (翻译数量: 0/100) */}
      <div className="flex items-center gap-1.5 text-xs select-none">
        <span className="font-medium text-ink">{t('translate.listStatsCount')}</span>
        <span className="font-mono font-semibold text-accent">{translatedCount.toLocaleString()}</span>
        <span className="font-mono text-ink-soft">/</span>
        <span className="font-mono text-ink">{itemsCount.toLocaleString()}</span>
        <span className="text-ink-soft text-[0.6875rem] ml-2">{t('translate.listPageRange', { from: rangeFrom, to: rangeTo, total: totalItems.toLocaleString() })}</span>
      </div>

      {/* Right: Pagination Controls */}
      <div className="inline-flex items-center gap-1.5">
        <label className="mr-1 inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem] text-ink-soft">
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

        <span className="mr-1 tabular-nums text-ink">
          {visiblePage} / {totalPages}
        </span>

        {/* Jump to page input: displayed when totalPages > 10 */}
        {totalPages > 10 ? (
          <form onSubmit={handleJumpSubmit} className="inline-flex items-center gap-1 mr-1 shrink-0">
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
          disabled={visiblePage >= totalPages}
          aria-label={t('translate.listPageLast')}
          tooltip={t('translate.listPageLast')}
          onClick={() => go(totalPages)}
        >
          <IoPlaySkipForwardOutline size={14} aria-hidden />
        </Button>

        {/* 分割线：隔开翻页与批量操作 */}
        <div className="mx-1 h-3.5 w-px bg-line shrink-0" aria-hidden="true" />

        {/* 批量重置当前页 */}
        <Button
          type="button"
          variant="ghost"
          disabled={savingPage || resettingPage || !hasItems}
          onClick={() => void handleResetPage()}
          tooltip={t('translate.listResetPageTooltip')}
          className="!h-7 px-2.5 text-xs whitespace-nowrap cursor-pointer border border-fail/40 bg-fail/10 text-fail hover:enabled:bg-fail/20 hover:enabled:border-fail/60 hover:enabled:text-fail"
        >
          {resettingPage ? <Spinner size="sm" /> : null}
          {t('translate.listResetPageBtn')}
        </Button>

        {/* 批量保存当前页 */}
        <Button
          type="button"
          variant="ghost"
          disabled={savingPage || resettingPage || !hasItems}
          onClick={() => void handleSavePage()}
          tooltip={t('translate.listSavePageTooltip')}
          className="!h-7 px-2.5 text-xs whitespace-nowrap font-medium cursor-pointer border border-ok/40 bg-ok/10 text-ok hover:enabled:bg-ok/20 hover:enabled:border-ok/60 hover:enabled:text-ok"
        >
          {savingPage ? <Spinner size="sm" /> : null}
          {t('translate.listSavePageBtn')}
        </Button>
      </div>
    </div>
  )
}
