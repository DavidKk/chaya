'use client'

import { useEffect, useRef } from 'react'

import { getDocumentModelContext, getWebMcpSupportReport, type WebMcpToolDefinition } from './model-context'
import { registerPageTools } from './register-page-tools'

const MAX_UNSUPPORTED_ATTEMPTS = 5
const RETRY_INTERVAL_MS = 1000

export interface UsePageWebMcpOptions {
  /** 注册成功后调用一次（浏览器支持 WebMCP）；返回的函数在卸载时调用。 */
  onRegistered?: () => (() => void) | void
}

/** 挂载时注册、卸载时注销；`buildTools` 只调一次，工具执行时自行经 ref 读取最新状态。 */
export function usePageWebMcp(registrarId: string, buildTools: () => WebMcpToolDefinition[], options: UsePageWebMcpOptions = {}): void {
  const buildToolsRef = useRef(buildTools)
  buildToolsRef.current = buildTools
  const onRegisteredRef = useRef(options.onRegistered)
  onRegisteredRef.current = options.onRegistered

  useEffect(() => {
    const controller = new AbortController()
    let attempts = 0
    let timer: number | undefined
    let cleanupRegistered: (() => void) | void

    const tryRegister = async () => {
      if (controller.signal.aborted) return
      attempts += 1
      try {
        const registered = await registerPageTools(registrarId, buildToolsRef.current(), controller.signal)
        if (controller.signal.aborted) return
        if (registered) {
          cleanupRegistered = onRegisteredRef.current?.()
          return
        }
        if (attempts < MAX_UNSUPPORTED_ATTEMPTS) {
          timer = window.setTimeout(() => void tryRegister(), RETRY_INTERVAL_MS)
        } else if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console -- 开发环境提示如何开启 WebMCP
          console.info(`[WebMCP] "${registrarId}" skipped`, getWebMcpSupportReport())
        }
      } catch (error) {
        // eslint-disable-next-line no-console -- 注册失败需在开发环境可见
        if (process.env.NODE_ENV === 'development') console.error(`[WebMCP] "${registrarId}" registration failed`, error)
        // One rejected tool must not block registrars that wait on `onRegistered`; the rest are registered.
        if (!controller.signal.aborted && getDocumentModelContext()) cleanupRegistered = onRegisteredRef.current?.()
      }
    }

    void tryRegister()
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      cleanupRegistered?.()
    }
  }, [registrarId])
}
