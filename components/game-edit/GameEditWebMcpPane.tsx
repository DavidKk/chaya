'use client'

import { WebMcpView } from '@/components/integration/webmcp/WebMcpView'

/** WebMCP support and registered tools as observed by the game window itself. */
export function GameEditWebMcpPane() {
  return <WebMcpView embedded />
}
