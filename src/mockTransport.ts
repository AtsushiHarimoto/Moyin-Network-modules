// ---------------------------------------------------------------------------
// @moyin/net-client — Mock transport layer
// ---------------------------------------------------------------------------

import type { HttpMethod, MockRoute, MockStreamRoute } from './types'

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const restRoutes: MockRoute[] = []
const streamRoutes: MockStreamRoute[] = []

export function registerMockRoute(route: MockRoute): void {
  restRoutes.push(route)
}

export function registerMockStreamRoute(route: MockStreamRoute): void {
  streamRoutes.push(route)
}

export function clearMockRoutes(): void {
  restRoutes.length = 0
  streamRoutes.length = 0
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function findMockRoute(method: HttpMethod, path: string): MockRoute | undefined {
  return restRoutes.find(r => r.method === method && r.path === path)
}

export function findMockStreamRoute(path: string): MockStreamRoute | undefined {
  return streamRoutes.find(r => r.path === path)
}

export function listMockRoutes(): { rest: MockRoute[]; stream: MockStreamRoute[] } {
  return { rest: [...restRoutes], stream: [...streamRoutes] }
}

// ---------------------------------------------------------------------------
// Execute — simulates a fetch call against registered mock routes
// ---------------------------------------------------------------------------

export async function mockFetch<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: T }> {
  const route = findMockRoute(method, path)

  if (!route) {
    return { ok: false, status: 404, data: { message: `No mock route for ${method} ${path}` } as T }
  }

  if (route.delay) {
    await new Promise(resolve => setTimeout(resolve, route.delay))
  }

  const data = route.handler(params, body)
  return { ok: true, status: 200, data: data as T }
}

// ---------------------------------------------------------------------------
// Stream mock
// ---------------------------------------------------------------------------

export async function mockStream(
  path: string,
  params?: Record<string, string>,
  onChunk?: (text: string) => void,
): Promise<void> {
  const route = findMockStreamRoute(path)
  if (!route) {
    throw new Error(`No mock stream route for ${path}`)
  }
  await route.handler(params, onChunk)
}
