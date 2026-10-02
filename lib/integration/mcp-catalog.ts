/**
 * Chaya MCP tool catalog — metadata only (no I/O), shared by `/api/mcp` and the integration page.
 * Implementations live in `app/api/mcp/_tools`; a unit test keeps both sides in sync.
 */

import { AGENT_INPUT_KEYS } from '@/lib/runtime/agent-protocol'

export const MCP_SERVER_NAME = 'chaya'
export const MCP_ENDPOINT_PATH = '/api/mcp'

export type McpToolGroupId = 'library' | 'game' | 'live' | 'edit' | 'translate' | 'cache' | 'logs'

export type McpToolMeta = {
  name: string
  group: McpToolGroupId
  title: string
  description: string
  inputSchema: JsonSchemaObject
  /** Equivalent HTTP API, for docs */
  http?: string
  /** Irreversible / destructive: the agent must ask the user first */
  destructive?: boolean
  /** Hidden unless `CHAYA_MCP_EVAL=1` */
  evalOnly?: boolean
  /** Pure read: no data, game or file changes */
  readOnly?: boolean
}

export type JsonSchema = {
  type?: string
  description?: string
  enum?: readonly (string | number)[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  default?: unknown
}
export type JsonSchemaObject = JsonSchema & { type: 'object'; properties: Record<string, JsonSchema> }

export const MCP_TOOL_GROUPS: readonly { id: McpToolGroupId; title: string; summary: string }[] = [
  { id: 'library', title: '游戏库', summary: '列出、绑定、备注、移除本机游戏库条目。' },
  { id: 'game', title: '当前游戏', summary: '本机磁盘侧：状态、启动 / 关闭、插件、NW.js 壳、窗口。' },
  { id: 'live', title: '局内实时', summary: '游戏运行中（需 ChayaAgent 插件）：读状态、调用插件修改、模拟按键。' },
  { id: 'edit', title: '修改目录', summary: '从游戏 data 查物品 / 角色 / 变量 / 开关等 id，配合局内修改使用。' },
  { id: 'translate', title: '翻译', summary: '翻译文本、抽取原文、整作补译任务、引擎与游戏内翻译设置。' },
  { id: 'cache', title: '共享翻译库', summary: '本机共享翻译库的查询筛选、修改、删除与导入。' },
  { id: 'logs', title: '日志', summary: '查询与清空服务 / 插件日志。' },
]

const ASK_FIRST = '破坏性操作：调用前必须先征得用户同意。'

function obj(properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchemaObject {
  return required.length ? { type: 'object', properties, required } : { type: 'object', properties }
}
const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, ...extra })
const num = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'number', description, ...extra })
const bool = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'boolean', description, ...extra })

const gameId = str('目标游戏 id（chaya_live_games 返回）；只有一个游戏在线时可省略')

export const CATALOG_KINDS = ['items', 'weapons', 'armors', 'actors', 'skills', 'states', 'classes', 'variables', 'switches'] as const
export const LOG_LEVEL_VALUES = ['ok', 'warn', 'fail', 'info', 'debug'] as const
export const TRANSLATE_ENGINE_VALUES = ['ollama', 'bing', 'google'] as const

export const MCP_TOOLS: readonly McpToolMeta[] = [
  // library
  {
    name: 'chaya_library_list',
    readOnly: true,
    group: 'library',
    title: '游戏库列表',
    description: '列出本机游戏库与当前绑定的游戏，可按名称 / 备注 / 路径关键词筛选。',
    inputSchema: obj({ q: str('关键词（不区分大小写）') }),
    http: 'GET /api/status',
  },
  {
    name: 'chaya_library_bind',
    group: 'library',
    title: '绑定游戏',
    description: '把一个游戏目录加入游戏库并切换为当前游戏（已在库中则只切换）。目录需是 RPG Maker MV/MZ 游戏根或其 www。',
    inputSchema: obj({ gameRoot: str('游戏目录绝对路径') }, ['gameRoot']),
    http: 'PUT /api/status',
  },
  {
    name: 'chaya_library_remark',
    group: 'library',
    title: '修改备注',
    description: '修改游戏库条目的备注，不切换当前游戏。remark 传空字符串或 null 清除备注。',
    inputSchema: obj({ gameRoot: str('游戏库中的游戏目录'), remark: str('备注内容') }, ['gameRoot', 'remark']),
  },
  {
    name: 'chaya_library_remove',
    group: 'library',
    title: '移除游戏',
    description: `从游戏库移除一个条目（不删除游戏文件）；移除当前游戏会解除绑定。${ASK_FIRST}`,
    inputSchema: obj({ gameRoot: str('游戏库中的游戏目录') }, ['gameRoot']),
    http: 'DELETE /api/status',
    destructive: true,
  },
  // game
  {
    name: 'chaya_game_status',
    readOnly: true,
    group: 'game',
    title: '当前游戏状态',
    description: '当前绑定游戏的详情：内容根、类型、壳是否就绪、插件安装情况、翻译缓存、游戏是否在线。',
    inputSchema: obj(),
    http: 'GET /api/status',
  },
  {
    name: 'chaya_game_launch',
    group: 'game',
    title: '启动游戏',
    description: '注入 / 更新插件并启动当前游戏。需已绑定游戏且壳就绪；游戏已在运行时会报错。',
    inputSchema: obj(),
    http: 'POST /api/launch',
  },
  {
    name: 'chaya_game_quit',
    group: 'game',
    title: '关闭游戏',
    description: '请求关闭正在运行的游戏（未保存进度会丢失，必要时先用 chaya_live_call 调 ChayaEdit.save 存档）。',
    inputSchema: obj(),
    http: 'DELETE /api/launch',
  },
  {
    name: 'chaya_game_plugins_install',
    group: 'game',
    title: '安装插件',
    description: '把 ChayaLoader 与插件缓存写入当前游戏并登记到 js/plugins.js；更新插件后重启游戏生效。',
    inputSchema: obj(),
    http: 'POST /api/plugins',
  },
  {
    name: 'chaya_game_plugins_clear',
    group: 'game',
    title: '清除插件',
    description: `从当前游戏清除 ChayaLoader、插件缓存与 Env。${ASK_FIRST}`,
    inputSchema: obj(),
    http: 'DELETE /api/plugins',
    destructive: true,
  },
  {
    name: 'chaya_game_shell_install',
    group: 'game',
    title: '安装 NW.js 壳',
    description: '为当前游戏安装 NW.js 壳。不传 shellSource 时从 nwjs.io 下载当前平台最新版（约 100 MB，最长约 5 分钟）。',
    inputSchema: obj({ shellSource: str('本机干净 NW.js 壳路径（可选）'), force: bool('已存在时强制覆盖') }),
    http: 'POST /api/shell',
  },
  {
    name: 'chaya_game_shell_check',
    readOnly: true,
    group: 'game',
    title: '检查壳更新',
    description: '检查当前游戏的 NW.js 壳是否有新版本。',
    inputSchema: obj(),
    http: 'GET /api/shell',
  },
  {
    name: 'chaya_game_shell_uninstall',
    group: 'game',
    title: '卸载共用壳',
    description: `卸载工具数据目录里的共用 NW.js 壳（不影响已打包游戏）。${ASK_FIRST}`,
    inputSchema: obj(),
    http: 'DELETE /api/shell',
    destructive: true,
  },
  {
    name: 'chaya_game_window',
    group: 'game',
    title: '游戏窗口',
    description: '读取或修改当前游戏 package.json 的窗口配置。不传 window 时只读；传入时只合并给出的字段，下次启动生效。',
    inputSchema: obj({
      window: {
        type: 'object',
        description: '要修改的窗口字段',
        properties: {
          title: str('窗口标题'),
          width: num('宽度'),
          height: num('高度'),
          resizable: bool('可调整大小'),
          fullscreen: bool('全屏'),
          frame: bool('显示窗口边框'),
          'always-on-top': bool('置顶'),
          position: str('初始位置，如 center'),
        },
      },
    }),
    http: 'GET / PUT /api/window',
  },
  // live
  {
    name: 'chaya_live_games',
    readOnly: true,
    group: 'live',
    title: '在线游戏',
    description: '列出已连接的游戏（需从 Chaya 启动且加载 ChayaAgent 插件）。',
    inputSchema: obj(),
  },
  {
    name: 'chaya_live_state',
    readOnly: true,
    group: 'live',
    title: '局内状态',
    description: '读取游戏当前状态：场景、地图与坐标、金钱、队伍（等级 / HP / MP）、对话文字与选项。修改前后用它确认效果。',
    inputSchema: obj({ gameId }),
  },
  {
    name: 'chaya_live_plugins',
    readOnly: true,
    group: 'live',
    title: '局内插件',
    description: '列出游戏内已加载的 Chaya 插件（ChayaEdit / ChayaBoost / ChayaTrans）、方法，以及插件声明的工具（tools：名称、说明、参数）。调用 chaya_live_call 前先看这里。',
    inputSchema: obj({ gameId }),
  },
  {
    name: 'chaya_live_call',
    group: 'live',
    title: '调用插件',
    description: [
      '调用游戏内 Chaya 插件的方法，结果以 JSON 返回。常用：',
      'ChayaEdit.gold(99999)、ChayaEdit.item(id, count)、ChayaEdit.weapon(id, count)、ChayaEdit.var(id, value)、ChayaEdit.sw(id, true)、',
      'ChayaEdit.god(true)、ChayaEdit.through(true)、ChayaEdit.teleport(mapId, x, y)、ChayaEdit.save(slot)、ChayaEdit.load(slot)、ChayaEdit.commonEvent(id)、',
      'ChayaBoost.on(rate) / off()、ChayaTrans.status()。id 可先用 chaya_edit_catalog 查。',
      '链式 API 用 chain，例如 plugin="ChayaEdit", method="actor", args=[1], chain=[{method:"hp", args:[999]}]。',
      '也可按插件声明的工具调用：传 tool（chaya_live_plugins 的 tools[].tool）与 input（对象参数），不传 method。',
    ].join(''),
    inputSchema: obj(
      {
        gameId,
        plugin: str('插件全局名，如 ChayaEdit、ChayaBoost、ChayaTrans'),
        method: str('方法名（与 tool 二选一）'),
        tool: str('插件声明的工具名，如 gold、status（与 method 二选一）'),
        input: { type: 'object', description: 'tool 的参数对象', properties: {} },
        args: { type: 'array', description: '位置参数', items: {} },
        chain: {
          type: 'array',
          description: '对返回值继续链式调用',
          items: obj({ method: str('方法名'), args: { type: 'array', items: {} } }, ['method']),
        },
      },
      ['plugin']
    ),
  },
  {
    name: 'chaya_live_press',
    group: 'live',
    title: '模拟按键',
    description: '模拟 RPG Maker 按键：ok=确认、cancel=取消、menu=菜单、方向键移动 / 选择。用于推进对话、选菜单、走动。',
    inputSchema: obj({ gameId, key: str('按键', { enum: AGENT_INPUT_KEYS }), frames: num('按住帧数（默认 6，约 0.1 秒；走一格约 16）') }, ['key']),
  },
  {
    name: 'chaya_live_eval',
    group: 'live',
    title: '执行 JS',
    description: `在游戏内执行任意 JS（可访问 $gameParty、$gameMap 等），支持 await，用 return 返回结果。仅当服务端设置 CHAYA_MCP_EVAL=1 时可用。${ASK_FIRST}`,
    inputSchema: obj({ gameId, code: str('函数体') }, ['code']),
    destructive: true,
    evalOnly: true,
  },
  // edit
  {
    name: 'chaya_edit_catalog',
    readOnly: true,
    group: 'edit',
    title: '查 id',
    description: '从当前游戏 data 读取指定类别的条目（id、名称、说明；有译文时显示中文），可按关键词筛选。修改物品 / 变量 / 开关前用它找 id。',
    inputSchema: obj(
      {
        kind: str('类别', { enum: CATALOG_KINDS }),
        q: str('名称 / 说明关键词，或 id'),
        limit: num('最多返回条数（默认 50，上限 500）'),
      },
      ['kind']
    ),
    http: 'GET /api/game-edit/catalog',
  },
  // translate
  {
    name: 'chaya_translate_text',
    group: 'translate',
    title: '翻译文本',
    description: '把日文翻成中文，优先命中缓存；默认把结果写入缓存。',
    inputSchema: obj(
      {
        texts: { type: 'array', description: '原文列表', items: { type: 'string' } },
        force: bool('跳过缓存强制重译'),
        persist: bool('是否写入缓存（默认 true）'),
      },
      ['texts']
    ),
    http: 'POST /api/translate',
  },
  {
    name: 'chaya_translate_extract',
    group: 'translate',
    title: '抽取原文',
    description: '从当前游戏 data/ 抽取可翻译文本，写入 / 合并 seed 文件。整作补译前先执行。',
    inputSchema: obj(),
    http: 'POST /api/extract',
  },
  {
    name: 'chaya_translate_job',
    group: 'translate',
    title: '补译任务',
    description: '服务端整作补译任务：start 开始、pause 暂停、status 查看进度。',
    inputSchema: obj({ action: str('动作', { enum: ['start', 'pause', 'status'] }) }, ['action']),
    http: 'POST /api/translate（mode=job / progress）',
  },
  {
    name: 'chaya_translate_batch',
    group: 'translate',
    title: '补译一批',
    description: '只对 seed 缺词补译一批（同步返回），适合小步验证。',
    inputSchema: obj({ limit: num('本批最多条数') }),
    http: 'POST /api/translate（mode=seed）',
  },
  {
    name: 'chaya_translate_engines',
    group: 'translate',
    title: '翻译引擎',
    description: '读取或修改翻译引擎开关与补译顺序。不传参数时只读。',
    inputSchema: obj({
      switches: { type: 'object', description: '引擎开关，如 {"google": false}', properties: Object.fromEntries(TRANSLATE_ENGINE_VALUES.map((id) => [id, bool(id)])) },
      order: { type: 'array', description: '补译顺序', items: str('引擎', { enum: TRANSLATE_ENGINE_VALUES }) },
    }),
    http: 'POST /api/translate（mode=switches）',
  },
  {
    name: 'chaya_translate_play_settings',
    group: 'translate',
    title: '游戏内翻译设置',
    description: '读取或修改当前游戏的游戏内翻译方式：pretranslated 预翻译、realtime 实时、subtitle 字幕；以及本地模型与超时。不传 settings 时只读。',
    inputSchema: obj({
      settings: {
        type: 'object',
        description: '要写入的设置',
        properties: {
          mode: str('翻译方式', { enum: ['pretranslated', 'realtime', 'subtitle'] }),
          model: str('Ollama 模型名，空串用服务端默认'),
          timeoutMs: num('单次超时毫秒（2000–30000）'),
        },
      },
    }),
    http: 'POST /api/translate（mode=play-settings）',
  },
  // cache
  {
    name: 'chaya_cache_query',
    readOnly: true,
    group: 'cache',
    title: '查询翻译库',
    description: '分页查询本机共享翻译库，支持关键词、引擎、只看敏感词与排序。',
    inputSchema: obj({
      q: str('原文 / 译文关键词'),
      engine: str('引擎筛选，如 ollama、bing、google、manual、import'),
      nsfw: bool('只看敏感词条'),
      sort: str('排序字段', { enum: ['updated', 'hits'] }),
      order: str('排序方向', { enum: ['desc', 'asc'] }),
      page: num('页码（从 1 开始）'),
      pageSize: num('每页条数（默认 50）'),
    }),
    http: 'GET /api/translate-cache',
  },
  {
    name: 'chaya_cache_update',
    group: 'cache',
    title: '修改译文',
    description: '按原文修改一条译文（标记为人工修订）。',
    inputSchema: obj({ src: str('原文（完全一致）'), zh: str('新译文') }, ['src', 'zh']),
    http: 'PATCH /api/translate-cache',
  },
  {
    name: 'chaya_cache_delete',
    group: 'cache',
    title: '删除译文',
    description: `按原文删除一条译文。${ASK_FIRST}`,
    inputSchema: obj({ src: str('原文（完全一致）') }, ['src']),
    http: 'DELETE /api/translate-cache',
    destructive: true,
  },
  {
    name: 'chaya_cache_import',
    group: 'cache',
    title: '导入译文',
    description: '导入 JSON（{"原文":"译文"}）或 NDJSON（["原文","译文"] / {"s","t"}）到共享翻译库。',
    inputSchema: obj({ text: str('文件内容'), overwrite: bool('覆盖已有译文（默认 false）') }, ['text']),
    http: 'POST /api/translate-cache',
  },
  // logs
  {
    name: 'chaya_logs_query',
    readOnly: true,
    group: 'logs',
    title: '查询日志',
    description: '查询最近的服务 / 插件日志，可按来源、级别、起始时间、关键词筛选。排查游戏或插件问题时先看这里。',
    inputSchema: obj({
      q: str('message / source 关键词'),
      source: str('来源，如 ChayaEdit、ChayaTrans、ChayaAgent、translate'),
      level: str('级别', { enum: LOG_LEVEL_VALUES }),
      since: num('起始时间（毫秒时间戳）'),
      limit: num('最多条数（默认 100，上限 1000）'),
    }),
    http: 'GET /api/logs',
  },
  {
    name: 'chaya_logs_clear',
    group: 'logs',
    title: '清空日志',
    description: `清空全部日志。${ASK_FIRST}`,
    inputSchema: obj(),
    http: 'DELETE /api/logs',
    destructive: true,
  },
]

export const MCP_INSTRUCTIONS = [
  '控制本机 Chaya：游戏库、启动游戏、局内修改、翻译与日志。',
  '工作流：chaya_game_status / chaya_live_state 看状态 → chaya_edit_catalog 查 id → chaya_live_call 修改 → 再读状态确认。',
  '标注「破坏性操作」的工具必须先征得用户同意。',
  '游戏在线时，插件声明的工具（chaya_plugin_*）会出现在工具列表中，随游戏连接增减；客户端未刷新列表时可用 chaya_live_plugins + chaya_live_call 的 tool 参数调用。',
].join('\n')

export function mcpToolsByGroup(tools: readonly McpToolMeta[] = MCP_TOOLS) {
  return MCP_TOOL_GROUPS.map((group) => ({ ...group, tools: tools.filter((tool) => tool.group === group.id) }))
}
