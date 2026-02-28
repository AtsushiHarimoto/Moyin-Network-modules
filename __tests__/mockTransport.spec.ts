import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerMockRoute,
  registerMockStreamRoute,
  clearMockRoutes,
  findMockRoute,
  findMockStreamRoute,
  listMockRoutes,
  mockFetch,
  mockStream,
} from '../src/mockTransport'

describe('mockTransport', () => {
  beforeEach(() => {
    clearMockRoutes()
  })

  it('mockFetch should return 404 for missing route', async () => {
    const result = await mockFetch('GET', '/not-registered')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })

  it('mockFetch should return data from registered route', async () => {
    registerMockRoute({
      method: 'POST',
      path: '/api/create',
      handler: (_params, body) => ({ received: body }),
    })

    const result = await mockFetch('POST', '/api/create', { name: 'test' })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ received: { name: 'test' } })
  })

  it('mockFetch should respect delay', async () => {
    registerMockRoute({
      method: 'GET',
      path: '/api/delayed',
      handler: () => ({ v: 1 }),
      delay: 50,
    })

    const start = Date.now()
    await mockFetch('GET', '/api/delayed')
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  it('findMockRoute should find registered route', () => {
    registerMockRoute({
      method: 'GET',
      path: '/api/find-me',
      handler: () => ({}),
    })
    expect(findMockRoute('GET', '/api/find-me')).toBeDefined()
    expect(findMockRoute('POST', '/api/find-me')).toBeUndefined()
  })

  it('findMockStreamRoute should find registered stream route', () => {
    registerMockStreamRoute({
      path: '/api/stream',
      handler: async () => {},
    })
    expect(findMockStreamRoute('/api/stream')).toBeDefined()
    expect(findMockStreamRoute('/api/other')).toBeUndefined()
  })

  it('listMockRoutes should return all routes', () => {
    registerMockRoute({ method: 'GET', path: '/a', handler: () => ({}) })
    registerMockStreamRoute({ path: '/b', handler: async () => {} })
    const routes = listMockRoutes()
    expect(routes.rest).toHaveLength(1)
    expect(routes.stream).toHaveLength(1)
  })

  it('clearMockRoutes should remove all routes', () => {
    registerMockRoute({ method: 'GET', path: '/a', handler: () => ({}) })
    registerMockStreamRoute({ path: '/b', handler: async () => {} })
    clearMockRoutes()
    const routes = listMockRoutes()
    expect(routes.rest).toHaveLength(0)
    expect(routes.stream).toHaveLength(0)
  })

  it('mockStream should throw for missing route', async () => {
    await expect(mockStream('/not-found')).rejects.toThrow('No mock stream route')
  })

  it('mockStream should call handler with chunks', async () => {
    const chunks: string[] = []
    registerMockStreamRoute({
      path: '/api/s',
      handler: async (_params, onChunk) => {
        onChunk?.('a')
        onChunk?.('b')
      },
    })
    await mockStream('/api/s', undefined, (text) => chunks.push(text))
    expect(chunks).toEqual(['a', 'b'])
  })
})
