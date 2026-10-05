'use client'

import { type ComponentType, useCallback, useEffect, useState } from 'react'
import { LuLayers } from 'react-icons/lu'
import { RiOpenaiFill } from 'react-icons/ri'
import { SiClaude, SiCursor } from 'react-icons/si'

import { useT } from '@/components/i18n/LocaleProvider'
import { uninstallButtonClass } from '@/components/integration/install-button'
import { useNotification } from '@/components/notification/useNotification'
import { Button, CopyField, Modal } from '@/components/sk'
import { DEFAULT_SITE_ORIGIN } from '@/constants/brand'
import { usePageOrigin } from '@/hooks/usePageOrigin'
import { readApiErrorMessage } from '@/lib/api-error'
import { SKILL_AGENT_TARGETS, type SkillAgentTargetId, type SkillId, skillInstallCommand } from '@/lib/integration/skills'
import type { SkillInstallStatus } from '@/services/integration/skill-install'

const API = '/api/integration/skills/install'

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const TARGET_ICONS: Record<SkillAgentTargetId, Icon> = { agents: LuLayers, codex: RiOpenaiFill, claude: SiClaude, cursor: SiCursor }

/** Shared dir first, then the same order as the MCP page */
const TARGET_ORDER: readonly SkillAgentTargetId[] = ['agents', 'codex', 'claude', 'cursor']

function useTargetLabel() {
  const t = useT()
  return useCallback((target: SkillAgentTargetId) => (target === 'agents' ? t('integration.targetUniversal') : SKILL_AGENT_TARGETS.find((item) => item.id === target)!.label), [t])
}

/** Local server: write / remove `SKILL.md` in each agent's global skills dir */
function LocalSkillInstall({ id }: { id: SkillId }) {
  const t = useT()
  const notify = useNotification()
  const labelOf = useTargetLabel()
  const [targets, setTargets] = useState<SkillInstallStatus | null>(null)
  const [busy, setBusy] = useState<SkillAgentTargetId | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const read = async () => {
      try {
        const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal })
        const data = (await res.json().catch(() => null)) as { targets?: SkillInstallStatus } | null
        if (res.ok && data?.targets) setTargets(data.targets)
      } catch {
        /* keep the last known status */
      }
    }
    void read()
    window.addEventListener('focus', read)
    return () => {
      controller.abort()
      window.removeEventListener('focus', read)
    }
  }, [id])

  async function act(target: SkillAgentTargetId, action: 'install' | 'uninstall') {
    const name = labelOf(target)
    setBusy(target)
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, target, action }) })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        notify.error(t('integration.clientActionFailed', { message: readApiErrorMessage(data, `HTTP ${res.status}`) }))
        return
      }
      setTargets((data as { targets: SkillInstallStatus }).targets)
      notify.success(t(action === 'install' ? 'integration.clientInstallDone' : 'integration.clientUninstallDone', { name }))
    } catch (error) {
      notify.error(t('integration.clientActionFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {TARGET_ORDER.map((target) => {
          const Icon = TARGET_ICONS[target]
          const name = labelOf(target)
          const installed = Boolean(targets?.[target].installed)
          const label = t(installed ? 'integration.clientUninstall' : 'integration.clientInstall', { name })
          return (
            <Button
              key={target}
              className={installed ? uninstallButtonClass : undefined}
              loading={busy === target}
              disabled={busy !== null || targets === null}
              aria-label={label}
              tooltip={label}
              onClick={() => void act(target, installed ? 'uninstall' : 'install')}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {name}
            </Button>
          )
        })}
      </div>
      <p className="m-0 text-xs leading-relaxed text-ink-soft">
        {t('integration.targetUniversalHint')} {t('integration.installEnglishNote')}
      </p>
    </div>
  )
}

/** Edge: same buttons; the page cannot write files, so each opens a modal with the curl command */
function CommandSkillInstall({ id }: { id: SkillId }) {
  const t = useT()
  const labelOf = useTargetLabel()
  const origin = usePageOrigin() || DEFAULT_SITE_ORIGIN
  const [open, setOpen] = useState<SkillAgentTargetId | null>(null)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {TARGET_ORDER.map((target) => {
          const Icon = TARGET_ICONS[target]
          const name = labelOf(target)
          const label = t('integration.clientInstall', { name })
          return (
            <Button key={target} aria-haspopup="dialog" aria-label={label} tooltip={label} onClick={() => setOpen(target)}>
              <Icon aria-hidden className="size-4 shrink-0" />
              {name}
            </Button>
          )
        })}
      </div>
      <p className="m-0 text-xs leading-relaxed text-ink-soft">
        {t('integration.targetUniversalHint')} {t('integration.installEnglishNote')}
      </p>
      <Modal open={open !== null} title={open ? labelOf(open) : ''} onClose={() => setOpen(null)} panelClassName="max-w-[36rem]">
        {open ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-ink-soft">{t('integration.installCommandHint')}</p>
            <CopyField value={skillInstallCommand(origin, id, open)} label={t('integration.installAria')} />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

/** 「安装到 Agent」（标题由所在列头提供）：本机一键写入 / 卸载全局 skills 目录，Edge 弹框给 curl 命令 */
export function SkillInstall({ id, local }: { id: SkillId; local: boolean }) {
  return local ? <LocalSkillInstall id={id} /> : <CommandSkillInstall id={id} />
}
