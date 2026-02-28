import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RequestManager } from '../src/requestManager'
import {
  registerMockRoute,
  clearMockRoutes,
  registerMockStreamRoute,
} from '../src/mockTransport'
import { resetNetStore, getSnapshot } from '../src/netStore'
import { clearNetTrace, getNetTraceSnapshot } from '../src/trace'

describe('RequestManager', () => {
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

  // -----------------------------------------------------------------------
  // Basic REST
  // -----------------------------------------------------------------------

  describe('REST request', () => {
    it('should return data on success', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/test',
        handler: () => ({ message: 'ok' }),
      })

      const { promise } = manager.request({
        method: 'GET',
        url: '/api/test',
      })

      const result = await promise
      expect(result.ok).toBe(true)
      expect(result.data).toEqual({ message: 'ok' })
      expect(result.finalState).toBe('ok')
      expect(result.retryCount).toBe(0)
    })

    it('should return error for missing mock route', async () => {
      const { promise } = manager.request({
        method: 'GET',
        url: '/api/not-found',
      })

      const result = await promise
      expect(result.ok).toBe(false)
      expect(result.finalState).toBe('error')
      expect(result.error?.code).toBe('http_error')
    })
  })

  // -----------------------------------------------------------------------
  // Policies
  // -----------------------------------------------------------------------

  describe('takeLatest policy', () => {
    it('should cancel previous request with same key', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => ({ v: 1 }),
        delay: 50,
      })

      const req1 = manager.request({
        method: 'GET',
        url: '/api/data',
        requestKey: 'fetch-data',
        policy: 'takeLatest',
      })

      const req2 = manager.request({
        method: 'GET',
        url: '/api/data',
        requestKey: 'fetch-data',
        policy: 'takeLatest',
      })

      const [r1, r2] = await Promise.all([req1.promise, req2.promise])
      expect(r1.finalState).toBe('stale_discarded')
      expect(r2.finalState).toBe('ok')
    })
  })

  describe('parallel policy', () => {
    it('should allow concurrent requests with same key', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => ({ v: 1 }),
      })

      const req1 = manager.request({
        method: 'GET',
        url: '/api/data',
        requestKey: 'fetch-data',
        policy: 'parallel',
      })

      const req2 = manager.request({
        method: 'GET',
        url: '/api/data',
        requestKey: 'fetch-data',
        policy: 'parallel',
      })

      const [r1, r2] = await Promise.all([req1.promise, req2.promise])
      expect(r1.finalState).toBe('ok')
      expect(r2.finalState).toBe('ok')
    })
  })

  describe('serial policy', () => {
    it('should execute requests sequentially', async () => {
      const order: number[] = []
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => {
          order.push(order.length + 1)
          return { step: order.length }
        },
        delay: 10,
      })

      const req1 = manager.request({
        method: 'GET',
        url: '/api/data',
        requestKey: 'serial-key',
        policy: 'serial',
      })

      const req2 = manager.request({
        method: 'GET',
        url: '/api/data',
        requestKey: 'serial-key',
        policy: 'serial',
      })

      const [r1, r2] = await Promise.all([req1.promise, req2.promise])
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
      expect(order).toEqual([1, 2])
    })
  })

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  describe('cancel', () => {
    it('should cancel by requestId', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/slow',
        handler: () => ({ v: 1 }),
        delay: 500,
      })

      const { requestId, promise } = manager.request({
        method: 'GET',
        url: '/api/slow',
      })

      // Cancel immediately
      const cancelled = manager.cancel(requestId)
      expect(cancelled).toBe(true)

      const result = await promise
      expect(result.ok).toBe(false)
      expect(result.finalState).toBe('canceled')
    })
  })

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  describe('loading state tracking', () => {
    it('should increment/decrement global loading count', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => ({ v: 1 }),
        delay: 50,
      })

      const { promise } = manager.request({
        method: 'GET',
        url: '/api/data',
        trackLoading: 'global',
      })

      // During request, loading count should be > 0
      expect(getSnapshot().globalLoadingCount).toBe(1)

      await promise
      expect(getSnapshot().globalLoadingCount).toBe(0)
    })

    it('should skip loading when silent', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => ({ v: 1 }),
        delay: 50,
      })

      const { promise } = manager.request({
        method: 'GET',
        url: '/api/data',
        silent: true,
      })

      expect(getSnapshot().globalLoadingCount).toBe(0)
      await promise
    })
  })

  // -----------------------------------------------------------------------
  // Trace
  // -----------------------------------------------------------------------

  describe('trace system', () => {
    it('should record trace events in dev mode', async () => {
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => ({ v: 1 }),
      })

      const { promise } = manager.request({
        method: 'GET',
        url: '/api/data',
        caseName: 'test-trace',
      })

      await promise

      const events = getNetTraceSnapshot()
      expect(events.length).toBeGreaterThanOrEqual(2) // start + end
      expect(events[0].eventType).toBe('request_start')
      expect(events[events.length - 1].eventType).toBe('request_end')
      expect(events[events.length - 1].finalState).toBe('ok')
    })

    it('should NOT record trace events when isDev=false', async () => {
      const prodManager = new RequestManager({ mode: 'mock', isDev: false })
      registerMockRoute({
        method: 'GET',
        path: '/api/data',
        handler: () => ({ v: 1 }),
      })

      const { promise } = prodManager.request({
        method: 'GET',
        url: '/api/data',
      })

      await promise
      expect(getNetTraceSnapshot()).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Streaming
  // -----------------------------------------------------------------------

  describe('streaming', () => {
    it('should stream chunks from mock', async () => {
      registerMockStreamRoute({
        path: '/api/stream',
        handler: async (_params, onChunk) => {
          onChunk?.('Hello ')
          onChunk?.('World')
        },
      })

      const chunks: string[] = []

      const handle = manager.stream({
        method: 'GET',
        url: '/api/stream',
        stream: true,
      })

      await new Promise<void>((resolve, reject) => {
        handle.onChunk(chunk => {
          if (!chunk.done) chunks.push(chunk.text)
        })
        handle.onDone(() => resolve())
        handle.onError(err => reject(err))
      })

      expect(chunks).toEqual(['Hello ', 'World'])
    })

    it('should cancel stream', async () => {
      registerMockStreamRoute({
        path: '/api/slow-stream',
        handler: async (_params, onChunk) => {
          onChunk?.('part1')
          await new Promise(r => setTimeout(r, 200))
          onChunk?.('part2')
        },
      })

      const chunks: string[] = []
      const handle = manager.stream({
        method: 'GET',
        url: '/api/slow-stream',
        stream: true,
      })

      handle.onChunk(chunk => {
        if (!chunk.done) chunks.push(chunk.text)
      })

      // Cancel after brief delay
      await new Promise(r => setTimeout(r, 50))
      handle.cancel()

      // Wait for stream to settle
      await new Promise(r => setTimeout(r, 300))

      // Should have received part1 but part2 may be skipped due to cancel
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      expect(chunks[0]).toBe('part1')
    })
  })
})
