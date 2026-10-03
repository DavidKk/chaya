'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { LuBookOpen, LuFolderOpen, LuTrash2 } from 'react-icons/lu'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { Badge, type BadgeTone, Button, CopyField, NumberInput } from '@/components/sk'
import type { MessageKey } from '@/lib/i18n'
import { MCP_SERVER_NAME } from '@/lib/integration/mcp-endpoint'
import type { McpGatewayState } from '@/lib/integration/mcp-gateway'
import { mcpJsonConfig } from '@/lib/integration/mcp-install'
import { MCP_GATEWAY_DEFAULT_PORT, MCP_PORT_MAX, MCP_PORT_MIN } from '@/lib/integration/mcp-port'
import { cn } from '@/lib/utils'

/** What both the in-game panel and the local integration page know about the gateway */
export type McpGatewayView = {
  state: McpGatewayState
  port: number
  url: string
  file: string
  fileExists: boolean
  holderRole?: 'server' | 'game'
  lastRequestAt?: number
}

type Props = {
  /** `game`: this game may serve; `server`: the local service page */
  context: 'game' | 'server'
  view: McpGatewayView | null
  /** false: no Node context in this game; everything is read-only */
  available?: boolean
  onSavePort: (port: number) => Promise<McpGatewayView | null>
  onDelete: () => Promise<McpGatewayView | null>
  onOpenFolder?: () => void
  onOpenDocs?: () => void
  /** false: address and mcp.json are shown elsewhere (local integration page) */
  connectionFields?: boolean
  className?: string
}

function stateCopy(view: McpGatewayView | null, context: Props['context'], available: boolean): { label: MessageKey; advice: MessageKey; tone: BadgeTone } {
  if (!available) return { label: 'mcpGateway.stateOff', advice: 'mcpGateway.adviceNoNode', tone: 'neutral' }
  switch (view?.state) {
    case 'listening':
      return { label: context === 'game' ? 'mcpGateway.stateListening' : 'mcpGateway.stateListeningServer', advice: 'mcpGateway.adviceListening', tone: 'ok' }
    case 'chaya':
      return view.holderRole === 'server'
        ? { label: 'mcpGateway.stateServer', advice: 'mcpGateway.adviceServer', tone: 'ok' }
        : { label: 'mcpGateway.stateOtherGame', advice: 'mcpGateway.adviceOtherGame', tone: 'info' }
    case 'occupied':
      return { label: 'mcpGateway.stateOccupied', advice: 'mcpGateway.adviceOccupied', tone: 'fail' }
    case 'off':
      return { label: 'mcpGateway.stateOff', advice: 'mcpGateway.adviceOff', tone: 'neutral' }
    default:
      return { label: 'mcpGateway.stateStarting', advice: 'mcpGateway.adviceListening', tone: 'neutral' }
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      {children}
    </div>
  )
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

/** Unified gateway: address, status + advice, port change, config file (delete / open), docs. */
export function McpGatewayCard({ context, view, available = true, onSavePort, onDelete, onOpenFolder, onOpenDocs, connectionFields = true, className }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const port = view?.port ?? MCP_GATEWAY_DEFAULT_PORT
  const [draft, setDraft] = useState(port)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null)
  const now = useNow(context === 'game' && !!view?.lastRequestAt)
  const copy = stateCopy(view, context, available)
  const url = view?.url ?? `http://127.0.0.1:${port}/mcp`
  const draftValid = Number.isInteger(draft) && draft >= MCP_PORT_MIN && draft <= MCP_PORT_MAX

  useEffect(() => setDraft(port), [port])

  async function run(action: () => Promise<McpGatewayView | null>, done: (next: McpGatewayView | null) => string) {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ tone: 'ok', text: done(await action()) })
    } catch (err) {
      setMessage({ tone: 'fail', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t('mcpGateway.deleteTitle'),
      description: t('mcpGateway.deleteDesc', { port: MCP_GATEWAY_DEFAULT_PORT }),
      confirmLabel: t('mcpGateway.deleteConfirm'),
      confirmVariant: 'fail',
    })
    if (ok) await run(onDelete, () => t('mcpGateway.deleted', { port: MCP_GATEWAY_DEFAULT_PORT }))
  }

  return (
    <section className={cn('flex flex-col gap-4', className)} aria-label={t('mcpGateway.regionAria')}>
      {connectionFields ? (
        <Field label={t('mcpGateway.address')}>
          <CopyField value={url} label={t('mcpGateway.address')} />
        </Field>
      ) : null}

      <Field label={t('mcpGateway.status')}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={copy.tone}>{t(copy.label)}</Badge>
          {context === 'game' && view?.state === 'listening' ? (
            <span className="text-xs text-ink-soft">
              {view.lastRequestAt ? t('mcpGateway.lastRequest', { seconds: Math.max(0, Math.round((now - view.lastRequestAt) / 1000)) }) : t('mcpGateway.lastRequestNever')}
            </span>
          ) : null}
        </div>
        <p className="m-0 text-xs leading-relaxed text-ink-soft">{t(copy.advice)}</p>
      </Field>

      <Field label={t('mcpGateway.port')}>
        <div className="flex flex-wrap items-center gap-2">
          <NumberInput
            className="w-32"
            value={draft}
            min={MCP_PORT_MIN}
            max={MCP_PORT_MAX}
            invalid={!draftValid}
            disabled={!available || busy}
            aria-label={t('mcpGateway.port')}
            tooltip=""
            onValueChange={setDraft}
          />
          <Button
            variant="default"
            disabled={!available || !draftValid || draft === port}
            loading={busy}
            onClick={() =>
              void run(
                () => onSavePort(draft),
                (next) => t('mcpGateway.portSaved', { port: next?.port ?? draft })
              )
            }
          >
            {t('mcpGateway.savePort')}
          </Button>
        </div>
        {message ? (
          <p role="status" className={cn('m-0 text-xs leading-relaxed', message.tone === 'ok' ? 'text-ok' : 'text-fail')}>
            {message.text}
          </p>
        ) : null}
      </Field>

      <Field label={t('mcpGateway.configFile')}>
        {view?.fileExists ? (
          <CopyField value={view.file} label={t('mcpGateway.configFile')} />
        ) : (
          <p className="m-0 text-xs text-ink-soft">{t('mcpGateway.configMissing', { port: MCP_GATEWAY_DEFAULT_PORT })}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="default" disabled={!available || !view?.fileExists || busy} onClick={() => void remove()}>
            <LuTrash2 size={14} aria-hidden />
            {t('mcpGateway.deleteConfig')}
          </Button>
          {onOpenFolder ? (
            <Button variant="default" disabled={!available || !view?.fileExists} onClick={onOpenFolder}>
              <LuFolderOpen size={14} aria-hidden />
              {t('mcpGateway.openFolder')}
            </Button>
          ) : null}
          {onOpenDocs ? (
            <Button variant="default" onClick={onOpenDocs}>
              <LuBookOpen size={14} aria-hidden />
              {t('mcpGateway.openDocs')}
            </Button>
          ) : null}
        </div>
      </Field>

      {connectionFields ? (
        <Field label={t('mcpGateway.configJson')}>
          <CopyField value={JSON.stringify(mcpJsonConfig({ name: MCP_SERVER_NAME, url }), null, 2)} label={t('mcpGateway.configJson')} />
        </Field>
      ) : null}
    </section>
  )
}
