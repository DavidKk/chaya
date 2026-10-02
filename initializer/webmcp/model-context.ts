export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean
  /** 返回内容含页面 / 外部文本，Agent 不应把它当作指令。 */
  untrustedContentHint?: boolean
  /** 会改变数据或触发后台任务，Agent 调用前应征求用户同意。 */
  consequentialHint?: boolean
}

export interface WebMcpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown
  annotations?: WebMcpToolAnnotations
}

export interface WebMcpRegisteredToolInfo {
  name: string
  description?: string
  origin?: string
}

export interface DocumentModelContext {
  registerTool: (definition: WebMcpToolDefinition, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown
  getTools?: () => Promise<WebMcpRegisteredToolInfo[]>
}

export interface WebMcpSupportReport {
  supported: boolean
  reason: 'supported' | 'no_secure_context' | 'api_missing' | 'no_document'
  hints: string[]
}

/** 取当前页面的 WebMCP 入口；旧版 Chromium 挂在 `navigator.modelContext`。 */
export function getDocumentModelContext(): DocumentModelContext | null {
  if (typeof document === 'undefined') return null
  const fromDocument = (document as Document & { modelContext?: DocumentModelContext }).modelContext
  if (typeof fromDocument?.registerTool === 'function') return fromDocument
  const fromNavigator = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { modelContext?: DocumentModelContext }).modelContext
  return typeof fromNavigator?.registerTool === 'function' ? fromNavigator : null
}

export function getWebMcpSupportReport(): WebMcpSupportReport {
  if (typeof document === 'undefined') {
    return { supported: false, reason: 'no_document', hints: ['WebMCP 只能在浏览器页面内注册。'] }
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { supported: false, reason: 'no_secure_context', hints: ['WebMCP 需要 HTTPS 或 localhost。'] }
  }
  if (!getDocumentModelContext()) {
    return {
      supported: false,
      reason: 'api_missing',
      hints: [
        '当前浏览器没有 document.modelContext.registerTool。',
        'Chrome 146+：打开 chrome://flags/#enable-webmcp-testing 设为 Enabled 并重启浏览器。',
        '重启后在控制台执行 document.modelContext?.getTools?.() 应返回工具列表。',
      ],
    }
  }
  return { supported: true, reason: 'supported', hints: [] }
}
