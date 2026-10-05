'use client'

import { type ComponentType, useMemo, useState } from 'react'
import { RiOpenaiFill } from 'react-icons/ri'
import { SiClaude, SiCursor } from 'react-icons/si'
import { VscVscodeOutline } from 'react-icons/vsc'

import { useT } from '@/components/i18n/LocaleProvider'
import { uninstallButtonClass } from '@/components/integration/install-button'
import { type McpClientAction, useMcpClients } from '@/components/integration/mcp/useMcpClients'
import { useNotification } from '@/components/notification/useNotification'
import { Button, CopyField, Modal, Tooltip } from '@/components/sk'
import { MCP_SERVER_NAME } from '@/lib/integration/mcp-catalog'
import { claudeCodeInstallCommand, codexInstallCommand, cursorInstallLink, vscodeInstallLink } from '@/lib/integration/mcp-install'
import type { McpCliClientId } from '@/services/integration/mcp-clients'

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

type LinkClient = { id: 'cursor' | 'vscode'; name: string; icon: Icon; link: string }
type CliClient = { id: McpCliClientId; name: string; icon: Icon; command: string }

const linkButtonClass =
  'inline-flex h-8 items-center gap-2 rounded-[0.2rem] border border-line bg-[var(--panel-2)] px-3 text-[0.8125rem] font-medium text-ink no-underline transition-colors hover:border-[rgb(230_238_248/0.18)] hover:bg-[color-mix(in_oklab,var(--panel-2)_80%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Cursor / VS Code fire their deep link; Claude Code / Codex install or uninstall in place, else copy the command from a modal */
export function McpClientInstall({ url }: { url: string }) {
  const t = useT()
  const notify = useNotification()
  const [openId, setOpenId] = useState<McpCliClientId | null>(null)
  const { clients: statuses, busy, run } = useMcpClients()

  const { linkClients, cliClients } = useMemo(() => {
    const input = { name: MCP_SERVER_NAME, url }
    const linkClients: LinkClient[] = [
      { id: 'cursor', name: 'Cursor', icon: SiCursor, link: cursorInstallLink(input) },
      { id: 'vscode', name: 'VS Code', icon: VscVscodeOutline, link: vscodeInstallLink(input) },
    ]
    const cliClients: CliClient[] = [
      { id: 'codex', name: t('integration.codex'), icon: RiOpenaiFill, command: codexInstallCommand(input) },
      { id: 'claude', name: t('integration.claudeCode'), icon: SiClaude, command: claudeCodeInstallCommand(input) },
    ]
    return { linkClients, cliClients }
  }, [t, url])

  const active = cliClients.find((client) => client.id === openId) ?? null

  async function act(client: CliClient, action: McpClientAction) {
    const error = await run(client.id, action)
    if (error) notify.error(t('integration.clientActionFailed', { message: error }))
    else notify.success(t(action === 'install' ? 'integration.clientInstallDone' : 'integration.clientUninstallDone', { name: client.name }))
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {cliClients.map((client) => {
          const { id, name, icon: Icon } = client
          const status = statuses?.[id]
          const icon = <Icon aria-hidden className="size-4 shrink-0" />
          if (!status?.cli) {
            return (
              <Button
                key={id}
                aria-haspopup="dialog"
                aria-label={t('integration.clientInstall', { name })}
                tooltip={t('integration.clientInstall', { name })}
                onClick={() => setOpenId(id)}
              >
                {icon}
                {name}
              </Button>
            )
          }
          const action: McpClientAction = status.installed ? 'uninstall' : 'install'
          const label = t(status.installed ? 'integration.clientUninstall' : 'integration.clientInstall', { name })
          return (
            <Button
              key={id}
              className={status.installed ? uninstallButtonClass : undefined}
              loading={busy === id}
              disabled={busy !== null}
              aria-label={label}
              tooltip={label}
              onClick={() => void act(client, action)}
            >
              {icon}
              {name}
            </Button>
          )
        })}
        {linkClients.map(({ id, name, icon: Icon, link }) => (
          <Tooltip key={id} content={t('integration.clientInstall', { name })}>
            <a className={linkButtonClass} href={link} aria-label={t('integration.clientInstall', { name })}>
              <Icon aria-hidden className="size-4 shrink-0" />
              {name}
            </a>
          </Tooltip>
        ))}
      </div>
      <Modal open={active !== null} title={active?.name ?? ''} onClose={() => setOpenId(null)} panelClassName="max-w-[36rem]">
        {active ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-ink-soft">{t('integration.installCommandHint')}</p>
            <CopyField value={active.command} label={active.name} />
          </div>
        ) : null}
      </Modal>
    </>
  )
}
