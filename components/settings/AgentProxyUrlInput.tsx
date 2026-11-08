'use client'

import { useEffect, useState } from 'react'
import { IoLink, IoLinkOutline } from 'react-icons/io5'

import { lockIconBtn } from '@/components/game-edit/lock-ui'
import { useT } from '@/components/i18n/LocaleProvider'
import { AffixedTextInput, Select, Tooltip } from '@/components/sk'
import { AGENT_PROXY_URL_SCHEMES, type AgentProxyUrlScheme, joinAgentProxyUrl, splitAgentProxyUrl } from '@/lib/game-agent/proxy'
import { cn } from '@/lib/utils'

const SCHEME_OPTIONS = AGENT_PROXY_URL_SCHEMES.map((scheme) => ({ value: scheme, label: `${scheme}//` }))
const ENDPOINT_PLACEHOLDER = '127.0.0.1:7890'

export type AgentProxyUrlInputProps = {
  /** Full proxy URL, or empty when inheriting the default. */
  value: string
  /** Shown as placeholder / seed when inheriting. */
  defaultValue?: string
  /** Scheme shown while the field is still empty (slot-specific). */
  defaultScheme?: AgentProxyUrlScheme
  inherit: boolean
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
  onChange: (next: string) => void
  onInheritChange: (inherit: boolean) => void
}

/** One chrome: scheme Select + host input + inherit icon (settings-local compound control). */
export function AgentProxyUrlInput({
  value,
  defaultValue = '',
  defaultScheme = 'http:',
  inherit,
  disabled = false,
  invalid = false,
  'aria-label': ariaLabel,
  onChange,
  onInheritChange,
}: AgentProxyUrlInputProps) {
  const t = useT()
  const fallback = splitAgentProxyUrl(defaultValue, defaultScheme)
  const parsed = splitAgentProxyUrl(value, defaultScheme)
  const [emptyScheme, setEmptyScheme] = useState<AgentProxyUrlScheme>(value.trim() ? parsed.scheme : defaultScheme)

  useEffect(() => {
    if (!value.trim()) setEmptyScheme(defaultScheme)
  }, [defaultScheme, value])

  const scheme = inherit ? fallback.scheme : value.trim() ? parsed.scheme : emptyScheme
  const endpoint = inherit ? '' : parsed.endpoint
  const inheritTip = t(inherit ? 'integration.agentProxyProtocolInheritOn' : 'integration.agentProxyProtocolInheritOff')

  return (
    <AffixedTextInput
      className="w-full"
      value={endpoint}
      placeholder={fallback.endpoint || ENDPOINT_PLACEHOLDER}
      spellCheck={false}
      disabled={disabled || inherit}
      invalid={invalid}
      aria-label={ariaLabel}
      prefix={
        <Select
          embedded
          className="w-[6.75rem]"
          panelWidth="content"
          value={scheme}
          options={SCHEME_OPTIONS}
          disabled={disabled || inherit}
          aria-label={ariaLabel ? `${ariaLabel} scheme` : undefined}
          onChange={(nextScheme) => {
            const schemeValue = nextScheme as AgentProxyUrlScheme
            onInheritChange(false)
            if (!endpoint.trim()) {
              setEmptyScheme(schemeValue)
              return
            }
            onChange(joinAgentProxyUrl(schemeValue, endpoint))
          }}
        />
      }
      endAction={
        <Tooltip content={inheritTip}>
          <button
            type="button"
            className={cn(lockIconBtn, inherit && 'text-accent hover:enabled:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:enabled:text-accent')}
            aria-label={inheritTip}
            aria-pressed={inherit}
            disabled={disabled}
            onClick={() => {
              // Toggle inherit only — never seed placeholder/default into the field.
              onInheritChange(!inherit)
            }}
          >
            {inherit ? <IoLink size={15} aria-hidden /> : <IoLinkOutline size={15} aria-hidden />}
          </button>
        </Tooltip>
      }
      onChange={(event) => {
        onInheritChange(false)
        onChange(joinAgentProxyUrl(scheme, event.target.value))
      }}
    />
  )
}
