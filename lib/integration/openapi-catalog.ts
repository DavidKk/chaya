import { LuActivity, LuDatabase, LuGamepad2, LuLanguages, LuScrollText, LuWrench } from 'react-icons/lu'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export type OpenApiEndpoint = {
  id: string
  method: HttpMethod
  path: string
  group: 'status' | 'edit' | 'saves' | 'translate' | 'logs' | 'agent'
  title: string
  description: string
  params?: Array<{ name: string; in: 'query' | 'path' | 'header'; required?: boolean; description: string; example?: string }>
  requestBody?: {
    contentType: string
    example: string
  }
  responseExample: string
}

export const OPENAPI_GROUPS = [
  { id: 'status', label: '服务与游戏状态', icon: LuGamepad2 },
  { id: 'edit', label: '游戏数据与修改', icon: LuWrench },
  { id: 'saves', label: '游戏存档', icon: LuDatabase },
  { id: 'translate', label: '离线与实时翻译', icon: LuLanguages },
  { id: 'logs', label: '运行时日志与慢请求', icon: LuScrollText },
  { id: 'agent', label: 'Agent 与 MCP 协议', icon: LuActivity },
] as const

export type OpenApiGroupId = (typeof OPENAPI_GROUPS)[number]['id']

export const OPENAPI_ENDPOINTS: readonly OpenApiEndpoint[] = [
  {
    id: 'status-get',
    method: 'GET',
    path: '/api/status',
    group: 'status',
    title: '获取服务与运行状态',
    description: '返回当前服务模式（local / app / remote）、系统宿主环境、绑定的游戏目录以及游戏连接在线状态。',
    responseExample: JSON.stringify(
      {
        ready: true,
        serviceMode: 'local',
        canUseDisk: true,
        host: { platform: 'darwin', version: '0.1.0' },
        activeGame: { id: 'game-1', name: 'Official MV Demo', path: '/path/to/game' },
      },
      null,
      2
    ),
  },
  {
    id: 'pick-post',
    method: 'POST',
    path: '/api/pick',
    group: 'status',
    title: '选择并绑定游戏目录',
    description: '通过原生目录选择器或指定绝对路径将游戏添加进当前工作区。',
    requestBody: {
      contentType: 'application/json',
      example: JSON.stringify({ path: '/Users/games/RPG_Project' }, null, 2),
    },
    responseExample: JSON.stringify({ ok: true, game: { id: 'rpg-1', name: 'RPG_Project' } }, null, 2),
  },
  {
    id: 'launch-post',
    method: 'POST',
    path: '/api/launch',
    group: 'status',
    title: '启动游戏进程',
    description: '启动绑定的游戏实例。支持设置启动模式（默认窗口、无头 silent 等）。',
    requestBody: {
      contentType: 'application/json',
      example: JSON.stringify({ mode: 'windowed' }, null, 2),
    },
    responseExample: JSON.stringify({ ok: true, pid: 12345, launchedAt: '2026-11-08T12:00:00Z' }, null, 2),
  },
  {
    id: 'launch-delete',
    method: 'DELETE',
    path: '/api/launch',
    group: 'status',
    title: '关闭当前运行的游戏',
    description: '向游戏进程发送退出信号或关闭受管理的子进程。',
    responseExample: JSON.stringify({ ok: true, message: 'Game terminated' }, null, 2),
  },
  {
    id: 'edit-catalog-get',
    method: 'GET',
    path: '/api/game-edit/catalog',
    group: 'edit',
    title: '查询游戏修改目录',
    description: '读取游戏全部可修改数值条目清单，包括物品、武器、防具、变量、开关和角色属性。',
    responseExample: JSON.stringify(
      {
        gold: 1500,
        items: [{ id: 1, name: 'Potion', count: 5 }],
        variables: [{ id: 1, name: 'StoryProgress', value: 3 }],
        switches: [{ id: 1, name: 'BossDefeated', value: true }],
      },
      null,
      2
    ),
  },
  {
    id: 'edit-map-get',
    method: 'GET',
    path: '/api/game-edit/map',
    group: 'edit',
    title: '查询地图详情',
    description: '获取指定编号地图的地块尺寸、元数据以及包含的事件对象列表。',
    params: [{ name: 'id', in: 'query', required: true, description: '地图编号，如 1', example: '1' }],
    responseExample: JSON.stringify(
      {
        mapId: 1,
        displayName: 'Town Square',
        width: 20,
        height: 15,
        eventsCount: 8,
      },
      null,
      2
    ),
  },
  {
    id: 'saves-settings-get',
    method: 'GET',
    path: '/api/game-saves/settings',
    group: 'saves',
    title: '查询存档配置',
    description: '获取自动存档、快速存档开关及槽位上限设置。',
    responseExample: JSON.stringify(
      {
        autoSaveEnabled: true,
        quickSaveEnabled: true,
        autoSaveMaxSlots: 5,
      },
      null,
      2
    ),
  },
  {
    id: 'saves-store-post',
    method: 'POST',
    path: '/api/game-saves/store',
    group: 'saves',
    title: '存档读写与备份',
    description: '执行存档索引读取、单槽读写、备份与快照还原操作。',
    requestBody: {
      contentType: 'application/json',
      example: JSON.stringify({ op: 'listEntries' }, null, 2),
    },
    responseExample: JSON.stringify({ ok: true, entries: [{ id: 'save_01', title: 'Chapter 1', timestamp: 1731000000 }] }, null, 2),
  },
  {
    id: 'translate-post',
    method: 'POST',
    path: '/api/translate',
    group: 'translate',
    title: '执行文本翻译',
    description: '调用已配置的翻译引擎（如 Ollama、OpenAI 等）对游戏剧情文本或单句执行翻译。',
    requestBody: {
      contentType: 'application/json',
      example: JSON.stringify({ texts: ['Hello, adventurer!'], srcLang: 'en', tgtLang: 'zh' }, null, 2),
    },
    responseExample: JSON.stringify({ ok: true, results: ['你好，冒险者！'] }, null, 2),
  },
  {
    id: 'translate-cache-get',
    method: 'GET',
    path: '/api/translate-cache',
    group: 'translate',
    title: '查询翻译缓存词库',
    description: '根据原文前缀或关键词检索已经确认并落盘的译文词条。',
    params: [{ name: 'q', in: 'query', description: '原文搜索关键词', example: 'Potion' }],
    responseExample: JSON.stringify({ total: 1, items: [{ src: 'Potion', zh: '药水', verified: true }] }, null, 2),
  },
  {
    id: 'logs-get',
    method: 'GET',
    path: '/api/logs',
    group: 'logs',
    title: '查询运行时与插件日志',
    description: '拉取最新产生的游戏控制台日志、慢请求记录与错误栈。',
    params: [
      { name: 'limit', in: 'query', description: '返回最大条数', example: '50' },
      { name: 'view', in: 'query', description: '视图类型：all / error / slow', example: 'error' },
    ],
    responseExample: JSON.stringify({ logs: [{ id: 1, level: 'info', message: 'Scene_Map loaded', timestamp: 1731000010 }] }, null, 2),
  },
  {
    id: 'mcp-post',
    method: 'POST',
    path: '/api/mcp',
    group: 'agent',
    title: 'MCP 协议 JSON-RPC 网关',
    description: '标准 Model Context Protocol JSON-RPC 端点，支持 tools/list 与 tools/call。',
    requestBody: {
      contentType: 'application/json',
      example: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, null, 2),
    },
    responseExample: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'chaya_library_list', description: 'List games' }] } }, null, 2),
  },
] as const

export function openApiSpec(origin = 'http://127.0.0.1:3000') {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const ep of OPENAPI_ENDPOINTS) {
    const method = ep.method.toLowerCase()
    if (!paths[ep.path]) paths[ep.path] = {}
    paths[ep.path][method] = {
      summary: ep.title,
      description: ep.description,
      tags: [ep.group],
      parameters: ep.params?.map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required ?? false,
        description: p.description,
        schema: { type: 'string', example: p.example },
      })),
      requestBody: ep.requestBody
        ? {
            required: true,
            content: {
              [ep.requestBody.contentType]: {
                schema: { type: 'object' },
                example: JSON.parse(ep.requestBody.example),
              },
            },
          }
        : undefined,
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              example: JSON.parse(ep.responseExample),
            },
          },
        },
      },
    }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Chaya REST & OpenAPI Services',
      version: '1.0.0',
      description: 'Standard HTTP RESTful API for external automation tools, agents, and scripts to interact with Chaya.',
    },
    servers: [{ url: origin, description: 'Current Chaya Instance' }],
    paths,
  }
}
