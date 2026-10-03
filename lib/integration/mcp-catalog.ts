/**
 * Chaya MCP tool catalog — metadata only (no I/O), shared by `/api/mcp` and the integration page.
 * Agent-facing text is English; page translations live in `mcp-catalog-messages.json`.
 * Implementations live in `app/api/mcp/_tools`; a unit test keeps both sides in sync.
 */

import { ASK_FIRST } from '@/lib/integration/ask-first'
import { AGENT_INPUT_KEYS } from '@/lib/runtime/agent-protocol'

export { MCP_ENDPOINT_PATH, MCP_SERVER_NAME } from '@/lib/integration/mcp-endpoint'

export const mcpEvalEnabled = () => process.env.CHAYA_MCP_EVAL === '1'

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
  { id: 'library', title: 'Library', summary: 'List, bind, annotate and remove entries in the local game library.' },
  { id: 'game', title: 'Current game', summary: 'On-disk side: status, launch / quit, plugins, NW.js shell, window.' },
  { id: 'live', title: 'Live game', summary: 'While the game runs (needs the ChayaAgent plugin): read state, call plugin edits, simulate keys.' },
  { id: 'edit', title: 'Edit catalog', summary: 'Look up item / actor / variable / switch ids in the game data for live edits.' },
  { id: 'translate', title: 'Translation', summary: 'Translate text, extract source text, whole-game fill jobs, engines and in-game translation settings.' },
  { id: 'cache', title: 'Translation library', summary: 'Query, edit, delete and import entries in the local shared translation library.' },
  { id: 'logs', title: 'Logs', summary: 'Query and clear server / plugin logs.' },
]

export { ASK_FIRST }

function obj(properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchemaObject {
  return required.length ? { type: 'object', properties, required } : { type: 'object', properties }
}
const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, ...extra })
const num = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'number', description, ...extra })
const bool = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'boolean', description, ...extra })

const gameId = str('Target game id (from chaya_live_games); optional when only one game is online')

export const CATALOG_KINDS = ['items', 'weapons', 'armors', 'actors', 'skills', 'states', 'classes', 'variables', 'switches'] as const
export const LOG_LEVEL_VALUES = ['ok', 'warn', 'fail', 'info', 'debug'] as const
export const TRANSLATE_ENGINE_VALUES = ['ollama', 'bing', 'google'] as const

export const MCP_TOOLS: readonly McpToolMeta[] = [
  // library
  {
    name: 'chaya_library_list',
    readOnly: true,
    group: 'library',
    title: 'List library',
    description: 'List the local game library and the currently bound game; filter by name / remark / path keyword.',
    inputSchema: obj({ q: str('Keyword (case-insensitive)') }),
    http: 'GET /api/status',
  },
  {
    name: 'chaya_library_bind',
    group: 'library',
    title: 'Bind game',
    description: 'Add a game folder to the library and make it the current game (only switches if already listed). The folder must be an RPG Maker MV/MZ game root or its www.',
    inputSchema: obj({ gameRoot: str('Absolute path of the game folder') }, ['gameRoot']),
    http: 'PUT /api/status',
  },
  {
    name: 'chaya_library_remark',
    group: 'library',
    title: 'Set remark',
    description: 'Change the remark of a library entry without switching the current game. Pass an empty string or null to clear it.',
    inputSchema: obj({ gameRoot: str('Game folder in the library'), remark: str('Remark text') }, ['gameRoot', 'remark']),
  },
  {
    name: 'chaya_library_remove',
    group: 'library',
    title: 'Remove game',
    description: `Remove an entry from the library (game files are kept); removing the current game unbinds it. ${ASK_FIRST}`,
    inputSchema: obj({ gameRoot: str('Game folder in the library') }, ['gameRoot']),
    http: 'DELETE /api/status',
    destructive: true,
  },
  // game
  {
    name: 'chaya_game_status',
    readOnly: true,
    group: 'game',
    title: 'Game status',
    description: 'Details of the bound game: content root, kind, shell readiness, plugin install state, translation cache and whether the game is online.',
    inputSchema: obj(),
    http: 'GET /api/status',
  },
  {
    name: 'chaya_game_launch',
    group: 'game',
    title: 'Launch game',
    description: 'Inject / update plugins and launch the current game. Needs a bound game with a ready shell; fails if the game is already running.',
    inputSchema: obj(),
    http: 'POST /api/launch',
  },
  {
    name: 'chaya_game_quit',
    group: 'game',
    title: 'Quit game',
    description: 'Ask the running game to close (unsaved progress is lost; save first with chaya_live_call ChayaEdit.save if needed).',
    inputSchema: obj(),
    http: 'DELETE /api/launch',
  },
  {
    name: 'chaya_game_plugins_install',
    group: 'game',
    title: 'Install plugins',
    description: 'Write ChayaLoader and the plugin cache into the current game and register them in js/plugins.js; restart the game to apply updates.',
    inputSchema: obj(),
    http: 'POST /api/plugins',
  },
  {
    name: 'chaya_game_plugins_clear',
    group: 'game',
    title: 'Clear plugins',
    description: `Remove ChayaLoader, the plugin cache and Env from the current game. ${ASK_FIRST}`,
    inputSchema: obj(),
    http: 'DELETE /api/plugins',
    destructive: true,
  },
  {
    name: 'chaya_game_shell_install',
    group: 'game',
    title: 'Install NW.js shell',
    description:
      'Install the NW.js shell for the current game. Without shellSource it downloads the latest build for this platform from nwjs.io (about 100 MB, up to ~5 minutes; retries resume the download); progress also shows in the console download center.',
    inputSchema: obj({ shellSource: str('Path to a clean local NW.js shell (optional)'), force: bool('Overwrite an existing shell') }),
    http: 'POST /api/shell',
  },
  {
    name: 'chaya_game_shell_check',
    readOnly: true,
    group: 'game',
    title: 'Check shell update',
    description: 'Check whether a newer NW.js shell is available for the current game.',
    inputSchema: obj(),
    http: 'GET /api/shell',
  },
  {
    name: 'chaya_game_shell_uninstall',
    group: 'game',
    title: 'Uninstall shared shell',
    description: `Uninstall the shared NW.js shell in the tool data folder (packaged games are unaffected). ${ASK_FIRST}`,
    inputSchema: obj(),
    http: 'DELETE /api/shell',
    destructive: true,
  },
  {
    name: 'chaya_game_window',
    group: 'game',
    title: 'Game window',
    description: 'Read or change the window config in the current game package.json. Without window it only reads; given fields are merged and apply on next launch.',
    inputSchema: obj({
      window: {
        type: 'object',
        description: 'Window fields to change',
        properties: {
          title: str('Window title'),
          width: num('Width'),
          height: num('Height'),
          resizable: bool('Resizable'),
          fullscreen: bool('Fullscreen'),
          frame: bool('Show window frame'),
          'always-on-top': bool('Always on top'),
          position: str('Initial position, e.g. center'),
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
    title: 'Online games',
    description: 'List connected games (launched from Chaya with the ChayaAgent plugin loaded).',
    inputSchema: obj(),
  },
  {
    name: 'chaya_live_state',
    readOnly: true,
    group: 'live',
    title: 'Live state',
    description:
      'Read the current game state: scene, map and position, gold, party (level / HP / MP), dialogue text and choices. Use it before and after edits to confirm the effect.',
    inputSchema: obj({ gameId }),
  },
  {
    name: 'chaya_live_plugins',
    readOnly: true,
    group: 'live',
    title: 'Live plugins',
    description:
      'List the Chaya plugins loaded in the game (ChayaEdit / ChayaBoost / ChayaTrans), their methods and the tools they declare (tools: name, description, params). Check here before chaya_live_call.',
    inputSchema: obj({ gameId }),
  },
  {
    name: 'chaya_live_call',
    group: 'live',
    title: 'Call plugin',
    description: [
      'Call a method of an in-game Chaya plugin; the result comes back as JSON. Common calls: ',
      'ChayaEdit.gold(99999), ChayaEdit.item(id, count), ChayaEdit.weapon(id, count), ChayaEdit.var(id, value), ChayaEdit.sw(id, true), ',
      'ChayaEdit.god(true), ChayaEdit.through(true), ChayaEdit.teleport(mapId, x, y), ChayaEdit.save(slot), ChayaEdit.load(slot), ChayaEdit.commonEvent(id), ',
      'ChayaBoost.on(rate) / off(), ChayaTrans.status(). Look up ids with chaya_edit_catalog first. ',
      'Use chain for chained APIs, e.g. plugin="ChayaEdit", method="actor", args=[1], chain=[{method:"hp", args:[999]}]. ',
      'You can also call a tool declared by the plugin: pass tool (tools[].tool from chaya_live_plugins) and input (object args) instead of method.',
    ].join(''),
    inputSchema: obj(
      {
        gameId,
        plugin: str('Plugin global name, e.g. ChayaEdit, ChayaBoost, ChayaTrans'),
        method: str('Method name (either method or tool)'),
        tool: str('Tool declared by the plugin, e.g. gold, status (either method or tool)'),
        input: { type: 'object', description: 'Argument object for tool', properties: {} },
        args: { type: 'array', description: 'Positional arguments', items: {} },
        chain: {
          type: 'array',
          description: 'Chained calls on the return value',
          items: obj({ method: str('Method name'), args: { type: 'array', items: {} } }, ['method']),
        },
      },
      ['plugin']
    ),
  },
  {
    name: 'chaya_live_press',
    group: 'live',
    title: 'Press key',
    description: 'Simulate RPG Maker keys: ok = confirm, cancel = back, menu = menu, arrows to move / select. Use it to advance dialogue, pick menus and walk.',
    inputSchema: obj({ gameId, key: str('Key', { enum: AGENT_INPUT_KEYS }), frames: num('Frames to hold (default 6, about 0.1 s; one tile is about 16)') }, ['key']),
  },
  {
    name: 'chaya_live_eval',
    group: 'live',
    title: 'Run JS',
    description: `Run arbitrary JS in the game (with access to $gameParty, $gameMap, etc.); await is supported and return gives the result. Only available when the server sets CHAYA_MCP_EVAL=1. ${ASK_FIRST}`,
    inputSchema: obj({ gameId, code: str('Function body') }, ['code']),
    destructive: true,
    evalOnly: true,
  },
  // edit
  {
    name: 'chaya_edit_catalog',
    readOnly: true,
    group: 'edit',
    title: 'Look up ids',
    description:
      'Read entries of a category from the current game data (id, name, description; translated text when available), filtered by keyword. Use it to find ids before editing items / variables / switches.',
    inputSchema: obj(
      {
        kind: str('Category', { enum: CATALOG_KINDS }),
        q: str('Name / description keyword, or id'),
        limit: num('Max entries (default 50, up to 500)'),
      },
      ['kind']
    ),
    http: 'GET /api/game-edit/catalog',
  },
  // translate
  {
    name: 'chaya_translate_text',
    group: 'translate',
    title: 'Translate text',
    description: 'Translate Japanese into Chinese, using the cache first; results are written to the cache by default.',
    inputSchema: obj(
      {
        texts: { type: 'array', description: 'Source texts', items: { type: 'string' } },
        force: bool('Skip the cache and retranslate'),
        persist: bool('Write results to the cache (default true)'),
      },
      ['texts']
    ),
    http: 'POST /api/translate',
  },
  {
    name: 'chaya_translate_extract',
    group: 'translate',
    title: 'Extract source text',
    description: 'Extract translatable text from the current game data/ and write / merge the seed file. Run it before a whole-game fill.',
    inputSchema: obj(),
    http: 'POST /api/extract',
  },
  {
    name: 'chaya_translate_job',
    group: 'translate',
    title: 'Fill job',
    description: 'Server-side whole-game fill job: start to begin, pause to pause, status for progress.',
    inputSchema: obj({ action: str('Action', { enum: ['start', 'pause', 'status'] }) }, ['action']),
    http: 'POST /api/translate (mode=job / progress)',
  },
  {
    name: 'chaya_translate_batch',
    group: 'translate',
    title: 'Fill one batch',
    description: 'Fill one batch of missing seed entries (returns synchronously); good for small checks.',
    inputSchema: obj({ limit: num('Max entries in this batch') }),
    http: 'POST /api/translate (mode=seed)',
  },
  {
    name: 'chaya_translate_engines',
    group: 'translate',
    title: 'Translation engines',
    description: 'Read or change engine switches and the fill order. Read-only without arguments.',
    inputSchema: obj({
      switches: { type: 'object', description: 'Engine switches, e.g. {"google": false}', properties: Object.fromEntries(TRANSLATE_ENGINE_VALUES.map((id) => [id, bool(id)])) },
      order: { type: 'array', description: 'Fill order', items: str('Engine', { enum: TRANSLATE_ENGINE_VALUES }) },
    }),
    http: 'POST /api/translate (mode=switches)',
  },
  {
    name: 'chaya_translate_play_settings',
    group: 'translate',
    title: 'In-game translation settings',
    description: 'Read or change how the current game translates in play: pretranslated, realtime or subtitle, plus the local model and timeout. Read-only without settings.',
    inputSchema: obj({
      settings: {
        type: 'object',
        description: 'Settings to write',
        properties: {
          mode: str('Translation mode', { enum: ['pretranslated', 'realtime', 'subtitle'] }),
          model: str('Ollama model name; empty string uses the server default'),
          timeoutMs: num('Per-request timeout in ms (2000–30000)'),
        },
      },
    }),
    http: 'POST /api/translate (mode=play-settings)',
  },
  // cache
  {
    name: 'chaya_cache_query',
    readOnly: true,
    group: 'cache',
    title: 'Query library',
    description: 'Page through the local shared translation library with keyword, engine, sensitive-only and sort filters.',
    inputSchema: obj({
      q: str('Source / translation keyword'),
      engine: str('Engine filter, e.g. ollama, bing, google, manual, import'),
      nsfw: bool('Sensitive entries only'),
      sort: str('Sort field', { enum: ['updated', 'hits'] }),
      order: str('Sort direction', { enum: ['desc', 'asc'] }),
      page: num('Page number (from 1)'),
      pageSize: num('Entries per page (default 50)'),
    }),
    http: 'GET /api/translate-cache',
  },
  {
    name: 'chaya_cache_update',
    group: 'cache',
    title: 'Edit translation',
    description: 'Change one translation by its source text (marked as a manual edit).',
    inputSchema: obj({ src: str('Source text (exact match)'), zh: str('New translation') }, ['src', 'zh']),
    http: 'PATCH /api/translate-cache',
  },
  {
    name: 'chaya_cache_delete',
    group: 'cache',
    title: 'Delete translation',
    description: `Delete one translation by its source text. ${ASK_FIRST}`,
    inputSchema: obj({ src: str('Source text (exact match)') }, ['src']),
    http: 'DELETE /api/translate-cache',
    destructive: true,
  },
  {
    name: 'chaya_cache_import',
    group: 'cache',
    title: 'Import translations',
    description: 'Import JSON ({"source":"translation"}) or NDJSON (["source","translation"] / {"s","t"}) into the shared translation library.',
    inputSchema: obj({ text: str('File content'), overwrite: bool('Overwrite existing translations (default false)') }, ['text']),
    http: 'POST /api/translate-cache',
  },
  // logs
  {
    name: 'chaya_logs_query',
    readOnly: true,
    group: 'logs',
    title: 'Query logs',
    description: 'Query recent server / plugin logs, filtered by source, level, start time or keyword. Check here first when debugging game or plugin issues.',
    inputSchema: obj({
      q: str('message / source keyword'),
      source: str('Source, e.g. ChayaEdit, ChayaTrans, ChayaAgent, translate'),
      level: str('Level', { enum: LOG_LEVEL_VALUES }),
      since: num('Start time (ms timestamp)'),
      limit: num('Max entries (default 100, up to 1000)'),
    }),
    http: 'GET /api/logs',
  },
  {
    name: 'chaya_logs_clear',
    group: 'logs',
    title: 'Clear logs',
    description: `Clear all logs. ${ASK_FIRST}`,
    inputSchema: obj(),
    http: 'DELETE /api/logs',
    destructive: true,
  },
]

export const MCP_INSTRUCTIONS = [
  'Control the local Chaya: game library, launching games, live edits, translation and logs.',
  'Workflow: read state with chaya_game_status / chaya_live_state → look up ids with chaya_edit_catalog → edit with chaya_live_call → read state again to confirm.',
  'Tools marked "Destructive" require the user\'s consent first.',
  'While a game is online, tools declared by its plugins (chaya_plugin_*) appear in the tool list and come and go with the connection; if the client has not refreshed the list, call them via chaya_live_plugins + the tool argument of chaya_live_call.',
].join('\n')

/** Live-game instructions for the in-game gateway (only `live` tools, never eval) */
export const MCP_GAME_INSTRUCTIONS = [
  'Chaya in-game gateway: live tools for the running game only (state, plugin edits, key presses).',
  'Library, launching, shell, translation library and log tools need the local Chaya server (dev or App).',
  'Workflow: chaya_live_state → chaya_live_plugins → chaya_live_call → chaya_live_state again to confirm.',
  'Tools marked "Destructive" require the user\'s consent first.',
].join('\n')

/** MCP standard annotations (hints only) from catalog metadata */
export function mcpToolAnnotations(meta: Pick<McpToolMeta, 'title' | 'readOnly' | 'destructive'>) {
  return { title: meta.title, ...(meta.readOnly ? { readOnlyHint: true } : {}), ...(meta.destructive ? { destructiveHint: true } : {}) }
}

export function mcpToolsByGroup(tools: readonly McpToolMeta[] = MCP_TOOLS) {
  return MCP_TOOL_GROUPS.map((group) => ({ ...group, tools: tools.filter((tool) => tool.group === group.id) }))
}
