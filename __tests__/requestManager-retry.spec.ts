import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RequestManager } from '../src/requestManager'
import { registerMockRoute, clearMockRoutes } from '../src/mockTransport'
import { NetHttpError } from '../src/errors'
import { resetNetStore } from '../src/netStore'
import { clearNetTrace, getNetTraceSnapshot } from '../src/trace'

describe('RequestManager — retry', () => {
  let manager: RequestManager

  beforeEach(() => {
    clearMockRoutes()
    resetNetStore()
    clearNetTrace()
    manager = new RequestManager({ mode: 'mock', isDev: true })
  })

  afterEach(() => {
    clearMockRoutes()
    resetNetStore()
    clearNetTrace()
  })

  it('should retry on retryable HTTP error and succeed on later attempt', async () => {
    let attempt = 0
    registerMockRoute({
      method: 'GET',
      path: '/api/flaky',
      handler: () => {
        attempt++
        if (attempt < 3) throw new NetHttpError('Server Error', 500)
        return { recovered: true }
      },
    })

    const { promise } = manager.request({
      method: 'GET',
      url: '/api/flaky',
      retry: { maxRetries: 3, baseDelayMs: 10, backoffFactor: 1 },
    })

    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ recovered: true })
    expect(result.retryCount).toBe(2)
  })

  it('should fail after exhausting retries', async () => {
    registerMockRoute({
      method: 'GET',
      path: '/api/always-fail',
      handler: () => { throw new NetHttpError('Server Error', 500) },
    })

    const { promise } = manager.request({
      method: 'GET',
      url: '/api/always-fail',
      retry: { maxRetries: 2, baseDelayMs: 10, backoffFactor: 1 },
    })

    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.retryCount).toBe(2)
    expect(result.error?.code).toBe('http_error')
  })

  it('should NOT retry non-retryable errors (e.g. 401)', async () => {
    let callCount = 0
    registerMockRoute({
      method: 'GET',
      path: '/api/unauthorized',
      handler: () => {
        callCount++
        throw new NetHttpError('Unauthorized', 401)
      },
    })

    const { promise } = manager.request({
      method: 'GET',
      url: '/api/unauthorized',
      retry: { maxRetries: 3, baseDelayMs: 10, backoffFactor: 1 },
    })

    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.retryCount).toBe(0)
    expect(callCount).toBe(1)
  })

  it('should emit retry trace events', async () => {
    let attempt = 0
    registerMockRoute({
      method: 'GET',
      path: '/api/retry-trace',
      handler: () => {
        attempt++
        if (attempt < 2) throw new NetHttpError('Error', 502)
        return { ok: true }
      },
    })

    const { promise } = manager.request({
      method: 'GET',
      url: '/api/retry-trace',
      retry: { maxRetries: 2, baseDelayMs: 10, backoffFactor: 1 },
    })

    await promise

    const events = getNetTraceSnapshot()
    const retryEvents = events.filter(e => e.eventType === 'request_retry')
    expect(retryEvents.length).toBe(1)
    expect(retryEvents[0].retryCount).toBe(1)
  })
})
