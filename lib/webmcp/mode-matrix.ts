/** MCP tools the Edge (browser-only) build cannot offer, with the reason shown to agents. */
export const EDGE_UNAVAILABLE_TOOLS: Readonly<Record<string, string>> = {
  chaya_game_launch: 'A web page cannot start local processes; open the game manually, or use local dev / the App',
  chaya_game_shell_uninstall: 'The shared shell directory only exists on the local service',
  chaya_live_eval: 'The web version has no server switch; the game link refuses arbitrary JS',
  chaya_translate_batch: 'The in-game translation runtime has no single-batch fill; use chaya_translate_job',
}

export function edgeUnavailableTools(): Array<{ name: string; reason: string }> {
  return Object.entries(EDGE_UNAVAILABLE_TOOLS).map(([name, reason]) => ({ name, reason }))
}
