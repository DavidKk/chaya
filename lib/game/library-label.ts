/** 游戏库条目的结构标签（server / 浏览器游戏库同一套文案） */
export function libraryKindLabel(kind: string | undefined, opts: { missing?: boolean; remote?: boolean; platform?: string } = {}): string {
  if (opts.remote) return '远程连接'
  if (opts.missing) return '路径失效'
  if (kind === 'www') return 'www 内容'
  if (kind === 'app.nw') return opts.platform === 'win32' ? '已打包 exe' : '已打包 .app'
  if (kind === 'content-root') return '内容根'
  return '游戏'
}
