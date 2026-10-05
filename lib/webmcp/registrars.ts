/** WebMCP registrar ids: who registered a page tool (integration page groups by these) */
export const PAGE_REGISTRAR_ID = 'chaya.page'
export const MCP_REGISTRAR_ID = 'chaya.mcp'
export const PLUGINS_REGISTRAR_ID = 'chaya.plugins'
export const AGENT_PROFILES_REGISTRAR_ID = 'chaya.agent-profiles'

/** URL segment of each registrar group on `/integration/webmcp/<slug>` */
export const WEBMCP_GROUP_SLUGS = { [PAGE_REGISTRAR_ID]: 'page', [MCP_REGISTRAR_ID]: 'mcp', [PLUGINS_REGISTRAR_ID]: 'plugins' } as const
