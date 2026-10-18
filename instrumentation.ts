export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { BUILD_TARGET } = await import('@/lib/service-mode/target')
  if (BUILD_TARGET === 'cloud' || process.env.VERCEL === '1') return
  const { localMcpGateway } = await import('@/services/integration/mcp-gateway')
  // Must not hold up server readiness: the gateway keeps retrying in the background.
  void localMcpGateway()
    .start()
    // eslint-disable-next-line no-console -- startup failure belongs in the server terminal
    .catch((err) => console.warn(`[Chaya] MCP gateway failed to start: ${err instanceof Error ? err.message : String(err)}`))
}
