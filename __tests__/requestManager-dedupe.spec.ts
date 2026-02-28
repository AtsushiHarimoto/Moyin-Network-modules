import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RequestManager } from '../src/requestManager'
import { registerMockRoute, clearMockRoutes } from '../src/mockTransport'
import { resetNetStore } from '../src/netStore'
import { clearNetTrace } from '../src/trace'

describe('RequestManager — dedupe policy', () => {
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

  it('should return same data for deduped requests', async () => {
    let callCount = 0
    registerMockRoute({
      method: 'GET',
      path: '/api/shared',
      handler: () => {
        callCount++
        return { value: callCount }
      },
      delay: 50,
    })

    const req1 = manager.request({
      method: 'GET',
      url: '/api/shared',
      requestKey: 'shared-data',
      policy: 'dedupe',
    })

    const req2 = manager.request({
      method: 'GET',
      url: '/api/shared',
      requestKey: 'shared-data',
      policy: 'dedupe',
    })

    const [r1, r2] = await Promise.all([req1.promise, req2.promise])

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r2.deduped).toBe(true)
    // Both should have the same data (from one actual call)
    expect(r1.data).toEqual(r2.data)
    // Handler should be called only once
    expect(callCount).toBe(1)
  })

  it('first request should NOT self-dedupe (no deadlock)', async () => {
    registerMockRoute({
      method: 'GET',
      path: '/api/single',
      handler: () => ({ ok: true }),
    })

    const { promise } = manager.request({
      method: 'GET',
      url: '/api/single',
      requestKey: 'single-key',
      policy: 'dedupe',
    })

    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.deduped).toBeUndefined()
  })

  it('should allow new request after deduped one completes', async () => {
    let callCount = 0
    registerMockRoute({
      method: 'GET',
      path: '/api/data',
      handler: () => {
        callCount++
        return { round: callCount }
      },
    })

    // First round
    const r1 = await manager.request({
      method: 'GET',
      url: '/api/data',
      requestKey: 'round-key',
      policy: 'dedupe',
    }).promise

    // Second round (should make a new request since first is done)
    const r2 = await manager.request({
      method: 'GET',
      url: '/api/data',
      requestKey: 'round-key',
      policy: 'dedupe',
    }).promise

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(callCount).toBe(2)
  })
})
