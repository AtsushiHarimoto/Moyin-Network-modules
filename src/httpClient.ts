// ---------------------------------------------------------------------------
// @moyin/net-client — Fetch-based HTTP client (framework-agnostic)
// ---------------------------------------------------------------------------

import type { HttpMethod, NetClientConfig } from './types'
import { NetHttpError, NetTimeoutError, normalizeToNetError } from './errors'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000

let config: NetClientConfig = {}

export function configure(c: NetClientConfig): void {
  config = { ...config, ...c }
}

export function getConfig(): Readonly<NetClientConfig> {
  return config
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export interface FetchOptions {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  params?: Record<string, unknown>
  timeoutMs?: number
  signal?: AbortSignal
}

export interface FetchResult<T = unknown> {
  ok: boolean
  status: number
  data: T
  headers: Headers
}

export async function fetchRequest<T = unknown>(opts: FetchOptions): Promise<FetchResult<T>> {
  const {
    method,
    timeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
  } = opts

  const prepared = await buildRequestInit(opts)

  // Timeout via AbortController
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  // Merge external signal
  const onExternalAbort = (): void => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) { controller.abort(); clearTimeout(timeoutId) }
    else externalSignal.addEventListener('abort', onExternalAbort)
  }

  const fetchInit: RequestInit = {
    method,
    headers: prepared.headers,
    signal: controller.signal,
  }

  if (prepared.body !== undefined) {
    fetchInit.body = prepared.body
  }

  let response: Response
  try {
    response = await fetch(prepared.url, fetchInit)
  } catch (err) {
    if (timedOut) throw new NetTimeoutError()
    throw normalizeToNetError(err)
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }

  let data: unknown
  try {
    const contentType = response.headers.get('content-type') ?? ''
    data = contentType.includes('application/json')
      ? await response.json()
      : await response.text()
  } catch {
    data = response.statusText
  }

  if (!response.ok) {
    throw new NetHttpError(
      typeof data === 'string' ? data : (data as Record<string, unknown>)?.message as string ?? response.statusText,
      response.status,
    )
  }

  return { ok: true, status: response.status, data: data as T, headers: response.headers }
}

// ---------------------------------------------------------------------------
// Shared URL / headers / body builder (used by fetchRequest and streaming)
// ---------------------------------------------------------------------------

export interface PreparedRequest {
  url: string
  headers: Record<string, string>
  body?: string
}

export async function buildRequestInit(opts: {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  params?: Record<string, unknown>
}): Promise<PreparedRequest> {
  const baseUrl = config.baseUrl ?? ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // Build full URL string by concatenation to avoid new URL() base restrictions
  let urlStr: string
  if (/^https?:\/\//.test(opts.url)) {
    // Already absolute
    urlStr = opts.url
  } else if (/^https?:\/\//.test(baseUrl)) {
    // baseUrl is absolute (e.g. "http://localhost:38881/api")
    urlStr = baseUrl.replace(/\/+$/, '') + '/' + opts.url.replace(/^\/+/, '')
  } else if (origin) {
    // baseUrl is relative (e.g. "/api") — prepend origin
    const prefix = origin + baseUrl.replace(/\/+$/, '')
    urlStr = prefix + '/' + opts.url.replace(/^\/+/, '')
  } else {
    // No origin (non-browser) and no absolute baseUrl — cannot resolve
    throw new Error(
      `Cannot construct absolute URL: no browser origin and baseUrl is not absolute ("${baseUrl}"). `
      + 'Call configure({ baseUrl: "http://..." }) before making requests outside a browser.',
    )
  }
  const fullUrl = new URL(urlStr)
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v != null) fullUrl.searchParams.set(k, String(v))
    }
  }

  const headers: Record<string, string> = {
    ...config.defaultHeaders,
    ...opts.headers,
  }
  if (opts.body !== undefined && opts.method !== 'GET') {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }
  if (config.getAuthToken) {
    const token = await Promise.resolve(config.getAuthToken())
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  return {
    url: fullUrl.toString(),
    headers,
    body: (opts.body !== undefined && opts.method !== 'GET') ? JSON.stringify(opts.body) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Convenience methods
// ---------------------------------------------------------------------------

export function get<T = unknown>(url: string, params?: Record<string, string>, opts?: Partial<FetchOptions>): Promise<FetchResult<T>> {
  return fetchRequest<T>({ ...opts, method: 'GET', url, params })
}

export function post<T = unknown>(url: string, body?: unknown, opts?: Partial<FetchOptions>): Promise<FetchResult<T>> {
  return fetchRequest<T>({ ...opts, method: 'POST', url, body })
}

export function put<T = unknown>(url: string, body?: unknown, opts?: Partial<FetchOptions>): Promise<FetchResult<T>> {
  return fetchRequest<T>({ ...opts, method: 'PUT', url, body })
}

export function patch<T = unknown>(url: string, body?: unknown, opts?: Partial<FetchOptions>): Promise<FetchResult<T>> {
  return fetchRequest<T>({ ...opts, method: 'PATCH', url, body })
}

export function del<T = unknown>(url: string, opts?: Partial<FetchOptions>): Promise<FetchResult<T>> {
  return fetchRequest<T>({ ...opts, method: 'DELETE', url })
}
