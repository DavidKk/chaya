/** MCP tools the Edge (browser-only) build cannot offer, with the reason shown to agents. */
export const EDGE_UNAVAILABLE_TOOLS: Readonly<Record<string, string>> = {
  chaya_game_launch: '网页不能启动本机进程；请手动打开游戏，或改用本机 dev / App',
  chaya_game_shell_uninstall: '共用壳目录只存在于本机服务',
  chaya_game_window: '网页版未实现 package.json 窗口配置',
  chaya_live_eval: '网页版无服务端开关，游戏连接拒绝执行任意 JS',
  chaya_translate_batch: '游戏内翻译运行时没有单批补译，请用 chaya_translate_job',
}

export function edgeUnavailableTools(): Array<{ name: string; reason: string }> {
  return Object.entries(EDGE_UNAVAILABLE_TOOLS).map(([name, reason]) => ({ name, reason }))
}
