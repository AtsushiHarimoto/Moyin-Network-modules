import { describe, it, expect } from 'vitest'
import {
  NetError,
  NetCanceledError,
  NetStaleDiscardedError,
  NetTimeoutError,
  NetHttpError,
  NetOfflineError,
  NetUnknownError,
  NetLateDiscardedError,
  normalizeToNetError,
  isRetryableError,
  resolveFinalStateFromError,
} from '../src/errors'

describe('Error classes', () => {
  it('NetError has correct code', () => {
    const e = new NetError('test', 'timeout')
    expect(e.code).toBe('timeout')
    expect(e.name).toBe('NetError')
    expect(e.message).toBe('test')
  })

  it('NetCanceledError defaults', () => {
    const e = new NetCanceledError()
    expect(e.code).toBe('canceled')
    expect(e.isCanceled).toBe(true)
    expect(e.messageKey).toBe('net.canceled')
  })

  it('NetStaleDiscardedError sets cancelReason', () => {
    const e = new NetStaleDiscardedError()
    expect(e.code).toBe('stale_discarded')
    expect(e.cancelReason).toBe('latest_replaced')
    expect(e.isStale).toBe(true)
  })

  it('NetTimeoutError', () => {
    const e = new NetTimeoutError()
    expect(e.code).toBe('timeout')
    expect(e.isTimeout).toBe(true)
  })

  it('NetHttpError stores status', () => {
    const e = new NetHttpError('Not Found', 404)
    expect(e.httpStatus).toBe(404)
    expect(e.code).toBe('http_error')
  })

  it('NetOfflineError', () => {
    const e = new NetOfflineError()
    expect(e.code).toBe('offline')
    expect(e.isOffline).toBe(true)
  })

  it('NetUnknownError', () => {
    const e = new NetUnknownError('oops')
    expect(e.code).toBe('unknown')
    expect(e.message).toBe('oops')
  })

  it('NetLateDiscardedError', () => {
    const e = new NetLateDiscardedError()
    expect(e.code).toBe('late_discarded')
  })
})

describe('normalizeToNetError', () => {
  it('returns NetError as-is', () => {
    const original = new NetTimeoutError()
    expect(normalizeToNetError(original)).toBe(original)
  })

  it('converts AbortError to NetCanceledError', () => {
    const err = new DOMException('Aborted', 'AbortError')
    const result = normalizeToNetError(err, 'req-1', 'key-1')
    expect(result.code).toBe('canceled')
    expect(result.requestId).toBe('req-1')
  })

  it('converts TypeError with fetch message to network_error', () => {
    const err = new TypeError('Failed to fetch')
    const result = normalizeToNetError(err)
    expect(result.code).toBe('network_error')
  })

  it('converts unknown to NetUnknownError', () => {
    const result = normalizeToNetError('some string')
    expect(result.code).toBe('unknown')
    expect(result.message).toBe('some string')
  })
})

describe('isRetryableError', () => {
  const defaultStatuses = [429, 500, 502, 503, 504]

  it('timeout is retryable', () => {
    expect(isRetryableError(new NetTimeoutError(), defaultStatuses)).toBe(true)
  })

  it('canceled is NOT retryable', () => {
    expect(isRetryableError(new NetCanceledError(), defaultStatuses)).toBe(false)
  })

  it('stale_discarded is NOT retryable', () => {
    expect(isRetryableError(new NetStaleDiscardedError(), defaultStatuses)).toBe(false)
  })

  it('http 500 is retryable', () => {
    expect(isRetryableError(new NetHttpError('err', 500), defaultStatuses)).toBe(true)
  })

  it('http 401 is NOT retryable', () => {
    expect(isRetryableError(new NetHttpError('err', 401), defaultStatuses)).toBe(false)
  })

  it('network_error is retryable', () => {
    const err = new NetError('fail', 'network_error')
    expect(isRetryableError(err, defaultStatuses)).toBe(true)
  })
})

describe('resolveFinalStateFromError', () => {
  it('undefined → ok', () => {
    expect(resolveFinalStateFromError(undefined)).toBe('ok')
  })

  it('canceled with latest_replaced → stale_discarded', () => {
    const e = new NetCanceledError()
    e.cancelReason = 'latest_replaced'
    expect(resolveFinalStateFromError(e)).toBe('stale_discarded')
  })

  it('canceled → canceled', () => {
    expect(resolveFinalStateFromError(new NetCanceledError())).toBe('canceled')
  })

  it('stale_discarded → stale_discarded', () => {
    expect(resolveFinalStateFromError(new NetStaleDiscardedError())).toBe('stale_discarded')
  })

  it('http_error → error', () => {
    expect(resolveFinalStateFromError(new NetHttpError('err', 500))).toBe('error')
  })
})
