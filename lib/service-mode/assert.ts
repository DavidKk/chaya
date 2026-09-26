import { NextResponse } from 'next/server'

import { apiError } from '@/initializer/response'

import { canUseDisk } from './mode'

const DISK_UNAVAILABLE_MESSAGE = '当前服务形态不支持本机磁盘操作'

/** 无盘形态下的标准 501 响应（能力不具备，非鉴权） */
export function diskUnavailable(): NextResponse {
  return apiError(501, 'DISK_UNAVAILABLE', DISK_UNAVAILABLE_MESSAGE)
}

/**
 * DiskOps Route 入口门禁。无盘时返回 501；有盘返回 null，继续业务。
 * 全仓只用 canUseDisk，勿散落 if (vercel)。
 */
export function requireDisk(): NextResponse | null {
  if (!canUseDisk()) return diskUnavailable()
  return null
}
