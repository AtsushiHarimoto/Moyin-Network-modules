// ---------------------------------------------------------------------------
// @moyin/net-client — Error class hierarchy
// ---------------------------------------------------------------------------

import type { CancelReason, NetFinalState } from './types'

export type NetErrorCode =
  | 'offline'
  | 'timeout'
  | 'canceled'
  | 'stale_discarded'
  | 'late_discarded'
  | 'http_error'
  | 'network_error'
  | 'unknown'

interface NetErrorOptions {
  requestId?: string
  requestKey?: string
  cancelReason?: CancelReason
}

export class NetError extends Error {
  code: NetErrorCode
  httpStatus?: number
  messageKey?: string
  debugMessage?: string
  requestId?: string
  requestKey?: string
  isOffline?: boolean
  isTimeout?: boolean
  isCanceled?: boolean
  isStale?: boolean
  cancelReason?: CancelReason

  constructor(message: string, code: NetErrorCode, options?: NetErrorOptions) {
    super(message)
    this.name = 'NetError'
    this.code = code
    this.requestId = options?.requestId
    this.requestKey = options?.requestKey
  }
}

export class NetCanceledError extends NetError {
  constructor(
    message = 'Request canceled',
    options?: NetErrorOptions,
  ) {
    super(message, 'canceled', options)
    this.name = 'NetCanceledError'
    this.isCanceled = true
    this.cancelReason = options?.cancelReason
    this.messageKey = 'net.canceled'
  }
}

export class NetStaleDiscardedError extends NetError {
  constructor(
    message = 'Request replaced by newer request',
    options?: NetErrorOptions,
  ) {
    super(message, 'stale_discarded', options)
    this.name = 'NetStaleDiscardedError'
    this.isStale = true
    this.isCanceled = true
    this.cancelReason = 'latest_replaced'
    this.messageKey = 'net.stale'
  }
}

export class NetTimeoutError extends NetError {
  constructor(
    message = 'Request timed out',
    options?: NetErrorOptions,
  ) {
    super(message, 'timeout', options)
    this.name = 'NetTimeoutError'
    this.isTimeout = true
    this.messageKey = 'net.timeout'
  }
}

export class NetHttpError extends NetError {
  override httpStatus: number

  constructor(
    message: string,
    status: number,
    options?: NetErrorOptions,
  ) {
    super(message, 'http_error', options)
    this.name = 'NetHttpError'
    this.httpStatus = status
    this.messageKey = 'net.http_error'
  }
}

export class NetOfflineError extends NetError {
  constructor(
    message = 'Network unavailable',
    options?: NetErrorOptions,
  ) {
    super(message, 'offline', options)
    this.name = 'NetOfflineError'
    this.isOffline = true
    this.messageKey = 'net.offline'
  }
}

export class NetUnknownError extends NetError {
  constructor(
    message = 'Unknown network error',
    options?: NetErrorOptions,
  ) {
    super(message, 'unknown', options)
    this.name = 'NetUnknownError'
    this.messageKey = 'net.unknown'
  }
}

export class NetLateDiscardedError extends NetError {
  constructor(
    message = 'Late response discarded',
    options?: NetErrorOptions,
  ) {
    super(message, 'late_discarded', options)
    this.name = 'NetLateDiscardedError'
    this.cancelReason = options?.cancelReason
    this.messageKey = 'net.late_discarded'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize any thrown value into a NetError */
export function normalizeToNetError(
  err: unknown,
  requestId?: string,
  requestKey?: string,
): NetError {
  if (err instanceof NetError) return err

  if (err instanceof DOMException && err.name === 'AbortError') {
    return new NetCanceledError('Request aborted', { requestId, requestKey, cancelReason: 'unknown' })
  }

  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    const e = new NetError(err.message, 'network_error', { requestId, requestKey })
    e.messageKey = 'net.network_error'
    return e
  }

  const msg = err instanceof Error ? err.message : String(err)
  return new NetUnknownError(msg, { requestId, requestKey })
}

/** Check if an error is retryable */
export function isRetryableError(error: NetError, retryOnStatuses: number[]): boolean {
  if (error.code === 'canceled' || error.code === 'stale_discarded') return false
  if (error.code === 'timeout' || error.code === 'network_error') return true
  if (error.code === 'http_error' && error.httpStatus != null) {
    return retryOnStatuses.includes(error.httpStatus)
  }
  return false
}

/** Resolve NetFinalState from error */
export function resolveFinalStateFromError(error?: NetError): NetFinalState {
  if (!error) return 'ok'
  if (error.code === 'stale_discarded') return 'stale_discarded'
  if (error.code === 'canceled' && error.cancelReason === 'latest_replaced') return 'stale_discarded'
  if (error.code === 'canceled') return 'canceled'
  if (error.code === 'late_discarded') return 'late_discarded'
  return 'error'
}
